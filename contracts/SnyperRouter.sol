// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/*
 * Snyper's own fee router on Robinhood Chain.
 *
 * SwapRouter02 will split a fee off a trade by itself, and for a flat charge on
 * a pool route that is the right tool — no contract of ours in the path, no new
 * code to trust. It caps that split at 1% and it knows nothing about a bonding
 * curve, which leaves two things it cannot do: charge a snype a real share of
 * what it made, and charge a launchpad trade at all.
 *
 * This is the smallest contract that does both. It takes an input, keeps a
 * share of whichever side of the trade is the funding asset, forwards the rest
 * to the venue that prices it, and hands the proceeds to the caller. It holds
 * nothing between transactions and sweeps what it is left with back to the
 * caller at the end of every one.
 *
 * What it deliberately does not have:
 *
 *   No owner, no admin, no pause, no upgrade path, no rescue function. A router
 *   people grant ERC-20 allowances to is worth exactly what its privileged
 *   functions can be made to do, so it has none. The treasury is fixed at
 *   construction for the same reason; rotating it means deploying again and
 *   pointing the app at the new address, which is a config change rather than a
 *   power this contract has to carry.
 *
 *   No caller-supplied call target. Every address it calls is either a constant
 *   below or resolved from the launchpad's own registry. A router that forwards
 *   arbitrary calldata to an arbitrary address is a router that spends every
 *   allowance anyone ever gave it.
 *
 * The caller's protection is one invariant, checked after the fee rather than
 * before it: the trade reverts unless what actually reaches them is at least
 * the minimum they asked for. No fee this contract can be asked to take is able
 * to cross that line.
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

interface IWETH9 {
    function withdraw(uint256 amount) external;
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

interface IPonsCurve {
    function pairToken() external view returns (address);
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
        external
        payable
        returns (uint256 tokensOut);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient)
        external
        returns (uint256 quoteOut);
}

interface IPonsV2Factory {
    /// The launchpad's record of one token. Every field is static, so this
    /// decodes as a flat tuple; only `curve` and `exists` are read here.
    struct LaunchRecord {
        address token;
        address curve;
        address deployer;
        address creatorFeeRecipient;
        address pairToken;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        uint8 phase;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 sweptAt;
        bool exists;
    }

    function getLaunchedToken(address token) external view returns (LaunchRecord memory);
}

contract SnyperRouter {
    /*
     * Chain 4663's own addresses, written in rather than passed in. Snyper
     * speaks to one network and these three are immutable on it — a Uniswap v3
     * router pins itself to its factory in its constructor, and a launchpad
     * factory is where its launches are recorded. Constants cannot be set
     * wrong at deployment, which is the failure this is guarding against.
     */
    ISwapRouter02 public constant V3_ROUTER =
        ISwapRouter02(0xCaf681a66D020601342297493863E78C959E5cb2);
    address public constant WETH9 = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    IPonsV2Factory public constant PONS_V2_FACTORY =
        IPonsV2Factory(0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e);

    /**
     * The ceiling on anything this contract will take, and the reason it is set
     * here: a snype is charged a tenth of its profit, and a profit is never
     * larger than the sale it came out of, so a tenth of one is never more than
     * a tenth of the other. 10% is what makes the intended charge always
     * expressible, and nothing above it is.
     */
    uint16 public constant MAX_FEE_BPS = 1_000;

    /// Native currency, as a token address. The zero address is not a token.
    address private constant NATIVE = address(0);

    address public immutable treasury;

    uint256 private locked = 1;

    error FeeTooHigh();
    error Expired();
    error NotALaunchpadToken();
    error WrongValue();
    error TooLittleReceived(uint256 received, uint256 minimum);
    error TransferFailed();
    error Reentrant();
    error ZeroTreasury();

    event Routed(
        address indexed caller,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee,
        address feeAsset
    );

    constructor(address treasury_) {
        if (treasury_ == address(0)) revert ZeroTreasury();
        treasury = treasury_;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrant();
        locked = 2;
        _;
        locked = 1;
    }

    modifier before(uint256 deadline, uint16 feeBps) {
        if (block.timestamp > deadline) revert Expired();
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        _;
    }

    /// Native currency arrives here from a WETH9 withdrawal, from a curve
    /// paying out a sale, and from a curve refunding a buy it could not fill.
    receive() external payable {}

    struct SwapParams {
        /// Zero for native currency on either side.
        address tokenIn;
        address tokenOut;
        uint24 poolFee;
        uint256 amountIn;
        /// What the caller must actually receive, measured after the fee.
        uint256 minOut;
        uint16 feeBps;
        /// Take the fee from the input rather than the output. Callers set this
        /// so the charge always lands in the funding asset of the trade.
        bool feeOnInput;
        uint256 deadline;
    }

    /**
     * A Uniswap v3 trade with Snyper's share taken off one end of it.
     *
     * The swap is told to pay this contract and to enforce no minimum of its
     * own; the bound that matters is applied below, to the amount that actually
     * leaves for the caller. One path, one check, and no arrangement of the
     * parameters that pays out less than was asked for.
     */
    function swapV3(SwapParams calldata p)
        external
        payable
        nonReentrant
        before(p.deadline, p.feeBps)
        returns (uint256 amountOut)
    {
        uint256 amountIn = _pullInput(p.tokenIn, p.amountIn);

        uint256 fee;
        address feeAsset;
        if (p.feeOnInput) {
            (amountIn, fee) = _skim(p.tokenIn, amountIn, p.feeBps);
            feeAsset = p.tokenIn;
        }

        address swapIn = p.tokenIn == NATIVE ? WETH9 : p.tokenIn;
        address swapOut = p.tokenOut == NATIVE ? WETH9 : p.tokenOut;

        if (p.tokenIn != NATIVE) _approve(swapIn, address(V3_ROUTER), amountIn);

        uint256 received = V3_ROUTER.exactInputSingle{
            value: p.tokenIn == NATIVE ? amountIn : 0
        }(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: swapIn,
                tokenOut: swapOut,
                fee: p.poolFee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        if (p.tokenOut == NATIVE) IWETH9(WETH9).withdraw(received);

        if (!p.feeOnInput) {
            (received, fee) = _skim(p.tokenOut, received, p.feeBps);
            feeAsset = p.tokenOut;
        }

        amountOut = _payOut(p.tokenOut, received, p.minOut);
        _sweep(p.tokenIn);

        emit Routed(msg.sender, p.tokenIn, p.tokenOut, p.amountIn, amountOut, fee, feeAsset);
    }

    struct CurveParams {
        /// The launched token. Its curve is resolved from the launchpad, never
        /// supplied by the caller — a curve address that can be passed in is a
        /// contract of the attacker's choosing.
        address token;
        bool buying;
        uint256 amountIn;
        uint256 minOut;
        uint16 feeBps;
        bool feeOnInput;
        uint256 deadline;
    }

    /**
     * A trade against a Pons bonding curve, which SwapRouter02 cannot reach and
     * therefore cannot charge for.
     *
     * The proceeds are measured as a balance delta rather than taken from the
     * return value, because a curve buy that clears the last of the sellable
     * supply fills short and refunds the difference. The refund is swept back
     * to the caller with everything else this contract is left holding.
     */
    function tradeCurve(CurveParams calldata p)
        external
        payable
        nonReentrant
        before(p.deadline, p.feeBps)
        returns (uint256 amountOut)
    {
        IPonsV2Factory.LaunchRecord memory record = PONS_V2_FACTORY.getLaunchedToken(p.token);
        if (!record.exists || record.curve == address(0)) revert NotALaunchpadToken();

        IPonsCurve curve = IPonsCurve(record.curve);
        address quote = curve.pairToken();
        address tokenIn = p.buying ? quote : p.token;
        address tokenOut = p.buying ? p.token : quote;

        uint256 amountIn = _pullInput(tokenIn, p.amountIn);

        uint256 fee;
        address feeAsset;
        if (p.feeOnInput) {
            (amountIn, fee) = _skim(tokenIn, amountIn, p.feeBps);
            feeAsset = tokenIn;
        }

        uint256 balanceBefore = _balance(tokenOut);

        if (p.buying) {
            if (quote != NATIVE) _approve(quote, address(curve), amountIn);
            // A native-quoted curve checks msg.value against quoteIn exactly.
            curve.buy{value: quote == NATIVE ? amountIn : 0}(amountIn, 0, address(this));
        } else {
            _approve(p.token, address(curve), amountIn);
            curve.sell(amountIn, 0, address(this));
        }

        uint256 received = _balance(tokenOut) - balanceBefore;

        if (!p.feeOnInput) {
            (received, fee) = _skim(tokenOut, received, p.feeBps);
            feeAsset = tokenOut;
        }

        amountOut = _payOut(tokenOut, received, p.minOut);
        _sweep(tokenIn);

        emit Routed(msg.sender, tokenIn, tokenOut, p.amountIn, amountOut, fee, feeAsset);
    }

    /* ------------------------------------------------------------------ */

    /**
     * Takes the input off the caller and reports what arrived. A token that
     * taxes its own transfers delivers less than it was sent, and every figure
     * after this one is measured rather than assumed so the difference is the
     * caller's to bear rather than something that reverts the trade later.
     */
    function _pullInput(address token, uint256 amount) private returns (uint256) {
        if (token == NATIVE) {
            if (msg.value != amount) revert WrongValue();
            return amount;
        }
        if (msg.value != 0) revert WrongValue();
        uint256 before_ = IERC20(token).balanceOf(address(this));
        _safeCall(
            token,
            abi.encodeCall(IERC20.transferFrom, (msg.sender, address(this), amount))
        );
        return IERC20(token).balanceOf(address(this)) - before_;
    }

    /// Splits the fee out of an amount and pays it, returning what is left.
    function _skim(address token, uint256 amount, uint16 feeBps)
        private
        returns (uint256 remaining, uint256 fee)
    {
        if (feeBps == 0 || amount == 0) return (amount, 0);
        fee = (amount * feeBps) / 10_000;
        if (fee == 0) return (amount, 0);
        _send(token, treasury, fee);
        remaining = amount - fee;
    }

    /// Hands the proceeds over, but only if they clear what was asked for.
    function _payOut(address token, uint256 amount, uint256 minOut) private returns (uint256) {
        if (amount < minOut) revert TooLittleReceived(amount, minOut);
        _send(token, msg.sender, amount);
        return amount;
    }

    /**
     * Returns whatever is still here to the caller: a curve's refund, the dust a
     * rounded fee leaves behind, native currency that arrived unasked. Nothing
     * accumulates, so there is never a balance worth attacking this contract for.
     */
    function _sweep(address token) private {
        if (token != NATIVE) {
            uint256 dust = IERC20(token).balanceOf(address(this));
            if (dust != 0) _send(token, msg.sender, dust);
        }
        uint256 native = address(this).balance;
        if (native != 0) _send(NATIVE, msg.sender, native);
    }

    function _balance(address token) private view returns (uint256) {
        return token == NATIVE ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    function _send(address token, address to, uint256 amount) private {
        if (token == NATIVE) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
            return;
        }
        _safeCall(token, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    /**
     * An allowance raised to exactly what this call needs. Tokens written before
     * the standard settled refuse a non-zero allowance moving to another
     * non-zero value, so it is cleared first — this contract never intends to
     * leave an allowance standing between trades anyway.
     */
    function _approve(address token, address spender, uint256 amount) private {
        _safeCall(token, abi.encodeCall(IERC20.approve, (spender, 0)));
        _safeCall(token, abi.encodeCall(IERC20.approve, (spender, amount)));
    }

    /// An ERC-20 call that treats an empty return as success, as most do.
    function _safeCall(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
