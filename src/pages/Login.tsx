
import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { continueAsGuest, signInWithUsername } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import logo from "@/assets/RCESS.png";

export default function Login() {
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isPending) return;

    setIsPending(true);

    try {
      const session = await signInWithUsername(username, password);

      if (session.role === "admin") {
        toast.success("Logged in as admin");
      } else if (session.role === "viewer") {
        toast("Logged in as viewer (read-only)");
      } else {
        toast(`Logged in as ${session.role}`);
      }

      navigate("/dashboard");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#030530] text-white">
      {/* Original background design */}
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-[#030530]"
        aria-hidden="true"
      />
      <div className="rcess-grid pointer-events-none" aria-hidden="true" />
      <div className="rcess-vignette pointer-events-none" aria-hidden="true" />
      <div className="rcess-scanlines pointer-events-none" aria-hidden="true" />
      <div className="rcess-cornerglow pointer-events-none" aria-hidden="true" />

      {/* Login page content */}
      <div className="relative z-10 mx-auto w-full max-w-[980px] px-4 py-8 sm:px-6 sm:py-10 md:px-10 md:py-12">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="rcess-logoWrap">
              <img
                src={logo}
                alt="Organization logo"
                className="h-20 w-20 shrink-0 rounded-full bg-white object-contain p-1 sm:h-24 sm:w-24 md:h-30 md:w-30"
              />
            </div>

            <div>
              <div className="text-[11px] tracking-[0.45em] text-cyan-300/80">
                PARSU • RCESS
              </div>

              <div className="mt-1 text-3xl font-semibold tracking-tight">
                Login
              </div>

              <div className="mt-2 text-xs text-white/40">
                Accounts are issued by the organizers. Use the username you were
                given.
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 md:mt-10">
          <Card className="rcess-panel p-0">
            <div className="p-6 md:p-7">
              <div className="rcess-subbar">
                <div className="text-sm font-medium">Sign in</div>
              </div>

              <form
                className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-5 md:p-6"
                onSubmit={handleSubmit}
              >
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <label
                      htmlFor="username"
                      className="text-xs tracking-[0.18em] text-white/60"
                    >
                      USERNAME
                    </label>

                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      autoFocus
                      placeholder="your-username"
                      className="border-white/15 bg-black/30 text-white placeholder:text-white/35"
                    />
                  </div>

                  <div className="grid gap-2">
                    <label
                      htmlFor="password"
                      className="text-xs tracking-[0.18em] text-white/60"
                    >
                      PASSWORD
                    </label>

                    <Input
                      id="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="border-white/15 bg-black/30 text-white placeholder:text-white/35"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button
                      type="submit"
                      disabled={isPending}
                      className="bg-cyan-300 text-black hover:bg-cyan-200 disabled:opacity-70"
                    >
                      {isPending ? "Signing in..." : "Login"}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      className="border-white/20 bg-transparent text-white hover:bg-white/10"
                      onClick={() => window.history.back()}
                    >
                      Back
                    </Button>
                  </div>

                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-cyan-300/35 bg-transparent text-cyan-100 hover:bg-cyan-300/10"
                      onClick={() => {
                        continueAsGuest();
                        toast(
                          "Continuing as guest (News + Leaderboard only)"
                        );
                        navigate("/dashboard");
                      }}
                    >
                      Continue as Guest
                    </Button>
                  </div>
                </div>
              </form>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
