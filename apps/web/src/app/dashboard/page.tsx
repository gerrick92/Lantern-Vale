import Link from "next/link";
import { PrivatePage } from "@/components/private-page";
import { WalletConnection } from "@/features/wallet/connection";
import { TokenOverview } from "@/features/wallet/token-overview";
import { Faucet } from "@/features/wallet/faucet";
import { RecentRounds } from "@/features/game/recent-rounds";
import { SupplyLedger } from "@/features/wallet/supply-ledger";
import { checkedAddress } from "@/lib/chain";
export const metadata = { title: "Dashboard" };
export default function Dashboard() {
  return (
    <>
      <h1>Dashboard</h1>
      <PrivatePage>
        <div className="two-column">
          <div>
            <section className="panel">
              <h2>Your wallet</h2>
              <WalletConnection />
            </section>
            <Faucet />
          </div>
          <div>
            <TokenOverview />
            <section className="panel">
              <h2>Lantern Vale</h2>
              <p>Your game and recent adventures.</p>
              <Link className="button" href="/adventure">
                Play
              </Link>
            </section>
          </div>
        </div>
        <SupplyLedger
          settlementAddress={
            process.env.SEPOLIA_GAME_ECONOMY_ADDRESS
              ? checkedAddress(process.env.SEPOLIA_GAME_ECONOMY_ADDRESS)
              : undefined
          }
        />
        <RecentRounds />
      </PrivatePage>
    </>
  );
}
