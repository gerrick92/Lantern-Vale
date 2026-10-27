import { PrivatePage } from "@/components/private-page";
import { WalletConnection } from "@/features/wallet/connection";
import { WalletCenter } from "@/features/wallet/wallet-center";
import { PixelCharacter } from "@/components/pixel-character";
export const metadata = { title: "Wallet" };
export default function WalletPage() {
  return (
    <>
      <h1>Wallet</h1>
      <PrivatePage>
        <div className="two-column">
          <section className="panel">
            <div className="security-intro">
              <PixelCharacter index={3} />
              <h2>Connect your wallet</h2>
            </div>
            <WalletConnection />
            <p className="small-note">Ethereum Sepolia · Test assets only</p>
          </section>
          <WalletCenter />
        </div>
      </PrivatePage>
    </>
  );
}
