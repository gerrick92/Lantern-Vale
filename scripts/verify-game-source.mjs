import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { keccak256, stringToHex } from "viem";

// Publishes only compiler-listed Solidity sources after local hash checks.
// This has no wallet, environment-secret reader, mint or activation operation.
const api = "https://sourcify.dev/server/v2";
async function main() {
  const mode = process.argv[2];
  if (!["--submit", "--status"].includes(mode))
    throw new Error(
      "Use --submit to publish verified Solidity sources, or --status to check the existing job.",
    );
  const deployed = JSON.parse(
    await readFile("deployments/game-economy.json", "utf8"),
  );
  if (
    deployed.status !== "PASS" ||
    deployed.chainId !== 11155111 ||
    !deployed.paused
  )
    throw new Error("Independently verify the paused deployment first.");
  let record;
  if (mode === "--submit") {
    const artifact = JSON.parse(
      await readFile(
        "contracts/out/LanternGameEconomy.sol/LanternGameEconomy.json",
        "utf8",
      ),
    );
    const sources = {};
    const root = resolve("contracts");
    for (const [name, metadata] of Object.entries(artifact.metadata.sources)) {
      if (
        !/^(src\/LanternGameEconomy\.sol|lib\/openzeppelin-contracts\/[A-Za-z0-9_/]+\.sol)$/.test(
          name,
        )
      )
        throw new Error(
          "Unexpected source outside the reviewed game contract dependencies.",
        );
      const path = resolve(root, name);
      const within = relative(root, path);
      if (within.startsWith("..") || isAbsolute(within))
        throw new Error("Source path escaped the contract folder.");
      const content = await readFile(path, "utf8");
      if (keccak256(stringToHex(content)) !== metadata.keccak256)
        throw new Error("A source differs from the compiled metadata.");
      sources[name] = { content };
    }
    const { compilationTarget, ...settings } = artifact.metadata.settings;
    if (
      JSON.stringify(compilationTarget) !==
      JSON.stringify({ "src/LanternGameEconomy.sol": "LanternGameEconomy" })
    )
      throw new Error("Unexpected compilation target.");
    const response = await fetch(`${api}/verify/11155111/${deployed.economy}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stdJsonInput: { language: "Solidity", sources, settings },
        compilerVersion: artifact.metadata.compiler.version,
        contractIdentifier: "src/LanternGameEconomy.sol:LanternGameEconomy",
        creationTransactionHash: deployed.deploymentHash,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    if (!response.ok || !/^[a-f0-9-]{36}$/.test(result.verificationId || ""))
      throw new Error(
        `Source submission was not accepted (HTTP ${response.status}).`,
      );
    record = {
      chainId: 11155111,
      address: deployed.economy,
      deploymentHash: deployed.deploymentHash,
      verificationId: result.verificationId,
      status: "SUBMITTED",
    };
  } else {
    record = JSON.parse(
      await readFile("deployments/game-source-verification.json", "utf8"),
    );
    if (
      record.address !== deployed.economy ||
      !/^[a-f0-9-]{36}$/.test(record.verificationId)
    )
      throw new Error("Source verification job differs from this deployment.");
    const response = await fetch(`${api}/verify/${record.verificationId}`, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error("Source verification status is unavailable.");
    const job = await response.json();
    record.job = job;
    record.status =
      job.contract?.creationMatch === "exact_match" &&
      job.contract?.runtimeMatch === "exact_match"
        ? "PASS"
        : "PENDING_OR_FAILED";
  }
  record.checkedAt = new Date().toISOString();
  record.url = `https://repo.sourcify.dev/11155111/${deployed.economy}`;
  await writeFile(
    "deployments/game-source-verification.json",
    JSON.stringify(record, null, 2) + "\n",
  );
  console.log(JSON.stringify(record));
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
