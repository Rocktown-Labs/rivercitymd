import { beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { fetchQuery } = vi.hoisted(() => ({ fetchQuery: vi.fn() }));
vi.mock("convex/nextjs", () => ({ fetchQuery }));
vi.mock("@/lib/auth-routing", () => ({
  getRoleHomePath: () => "/dashboard",
  getProtectedRouteRedirect: () => null,
}));
vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: (handler: unknown) => handler,
  createRouteMatcher: (patterns: string[]) => (req: NextRequest) =>
    patterns.some((pattern) =>
      pattern.endsWith("(.*)")
        ? req.nextUrl.pathname.startsWith(pattern.slice(0, -4))
        : req.nextUrl.pathname === pattern,
    ),
}));
import proxy from "./proxy";
const run = proxy as unknown as (
  auth: () => Promise<unknown>,
  req: NextRequest,
) => Promise<Response>;

beforeEach(() => fetchQuery.mockReset());

function session(token: string | null) {
  return async () => ({
    isAuthenticated: true,
    sessionClaims: {},
    getToken: async () => token,
    redirectToSignIn: vi.fn(),
  });
}

test("an authenticated customer with a missing backend token does not restart sign-in", async () => {
  const result = await run(
    session(null),
    new NextRequest("https://example.com/dashboard"),
  );
  expect(result.headers.get("location")).toBe("https://example.com/onboarding");
  const onboarding = await run(
    session(null),
    new NextRequest("https://example.com/onboarding"),
  );
  expect(onboarding.headers.get("location")).toBeNull();
});

test("Google callback is allowed to complete even after Clerk authenticates", async () => {
  const result = await run(
    session("token"),
    new NextRequest("https://example.com/sign-in/sso-callback"),
  );
  expect(result.headers.get("location")).toBeNull();
  expect(fetchQuery).not.toHaveBeenCalled();
});
