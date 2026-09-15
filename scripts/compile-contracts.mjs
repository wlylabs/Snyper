/**
 * Compiles everything in contracts/ and writes the artifact the app and the
 * tests both read. solc is a dev-time dependency only; nothing in the built
 * app imports it.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "contracts");
const outDir = join(root, "contracts", "out");

const sources = {};
for (const file of readdirSync(srcDir).filter((f) => f.endsWith(".sol"))) {
  sources[file] = { content: readFileSync(join(srcDir, file), "utf8") };
}

const output = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources,
      settings: {
        optimizer: { enabled: true, runs: 400 },
        viaIR: true,
        evmVersion: "cancun",
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
      },
    }),
  ),
);

const errors = (output.errors ?? []).filter((e) => e.severity === "error");
for (const note of output.errors ?? []) console.log(note.formattedMessage.trimEnd());
if (errors.length) process.exit(1);

mkdirSync(outDir, { recursive: true });
for (const [file, contracts] of Object.entries(output.contracts ?? {})) {
  for (const [name, artifact] of Object.entries(contracts)) {
    const path = join(outDir, `${name}.json`);
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          abi: artifact.abi,
          bytecode: `0x${artifact.evm.bytecode.object}`,
          deployedBytecode: `0x${artifact.evm.deployedBytecode.object}`,
        },
        null,
        2,
      )}\n`,
    );
    const size = artifact.evm.deployedBytecode.object.length / 2;
    console.log(`${file}:${name} -> contracts/out/${name}.json (${size} bytes deployed)`);
  }
}
