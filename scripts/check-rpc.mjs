const endpoint =
  process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_chainId",
    params: [],
  }),
  signal: AbortSignal.timeout(15000),
});
const data = await response.json();
if (!response.ok || data.result !== "0xaa36a7")
  throw new Error("RPC did not return Ethereum Sepolia chain ID 11155111.");
console.log(
  "PASS: RPC reports Ethereum Sepolia, chain ID 11155111. No wallet balance was inferred.",
);
