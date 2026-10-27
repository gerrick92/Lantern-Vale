import { createRoot } from "react-dom/client";
import { AuthForm } from "../../../apps/web/src/features/auth/auth-form";

const mode = new URL(location.href).searchParams.get("mode");
createRoot(document.getElementById("root")!).render(
  <main className="account-page">
    <h1>{mode === "reset" ? "Reset password" : "Create account"}</h1>
    <AuthForm initialMode={mode === "reset" ? "reset" : "register"} />
  </main>,
);
