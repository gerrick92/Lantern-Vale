"use client";
import { WalletOwnership } from "@/features/wallet/ownership";
import { ProfileForm } from "./profile-form";

export function AccountSettings() {
  return (
    <section className="panel">
      <h2>Your profile and wallet</h2>
      <ProfileForm />
      <h3 className="section">Wallet connection</h3>
      <WalletOwnership />
    </section>
  );
}
