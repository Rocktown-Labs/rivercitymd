import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import { getProtectedRouteRedirect, getRoleHomePath } from "@/lib/auth-routing";
const isPublicRoute = createRouteMatcher([
  "/",
  "/book(.*)",
  "/booking(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/r2-upload-relay",
  "/robots.txt",
  "/sitemap.xml",
]);

const isOnboardingRoute = createRouteMatcher(["/onboarding(.*)"]);
const isAdminRoute = createRouteMatcher(["/admin(.*)"]);
const isCustomerRoute = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const { isAuthenticated, sessionClaims, redirectToSignIn, getToken } =
    await auth();
  const url = new URL(req.url);

  const isAuthRoute =
    url.pathname.startsWith("/sign-in") || url.pathname.startsWith("/sign-up");

  // Handle sign-in/sign-up routes first so authenticated users are redirected
  // instead of getting stuck on an auth page.
  if (isAuthRoute) {
    if (!isAuthenticated) {
      return NextResponse.next();
    }

    // Fast path: Clerk metadata says onboarding is complete.
    if (sessionClaims?.metadata?.onboardingComplete) {
      try {
        const token = await getToken({ template: "convex" });
        if (token) {
          const userRole = await fetchQuery(
            api.auth.getUserRole,
            {},
            {
              url: process.env.NEXT_PUBLIC_CONVEX_URL!,
              token: token,
            },
          );
          if (userRole?.type === "admin") {
            const readiness = await fetchQuery(
              api.setupReadiness.getPublicBookingReadiness,
              {},
              {
                url: process.env.NEXT_PUBLIC_CONVEX_URL!,
                token: token,
              },
            );

            if (!readiness.isReady) {
              return NextResponse.redirect(
                new URL("/admin/settings?setup=required", req.url),
              );
            }

            return NextResponse.redirect(
              new URL(getRoleHomePath("admin", readiness.isReady), req.url),
            );
          }
          return NextResponse.redirect(new URL(getRoleHomePath("client"), req.url));
        }
      } catch (error) {
        console.error("Error getting user role on auth route:", error);
      }
      return NextResponse.redirect(new URL(getRoleHomePath("client"), req.url));
    }

    // Fallback: check Convex if metadata isn't complete/missing.
    try {
      const token = await getToken({ template: "convex" });

      // If Convex token is missing (template not ready/misconfigured), don't loop on /sign-in.
      if (!token) {
        return NextResponse.redirect(new URL("/onboarding", req.url));
      }

      const userRole = await fetchQuery(
        api.auth.getUserRole,
        {},
        {
          url: process.env.NEXT_PUBLIC_CONVEX_URL!,
          token: token,
        },
      );

      if (!userRole) {
        return NextResponse.redirect(new URL("/onboarding", req.url));
      }

      const hasCompleted = await fetchQuery(
        api.users.hasCompletedOnboarding,
        {},
        {
          url: process.env.NEXT_PUBLIC_CONVEX_URL!,
          token: token,
        },
      );

      if (!hasCompleted) {
        return NextResponse.redirect(new URL("/onboarding", req.url));
      }

      if (userRole.type === "admin") {
        const readiness = await fetchQuery(
          api.setupReadiness.getPublicBookingReadiness,
          {},
          {
            url: process.env.NEXT_PUBLIC_CONVEX_URL!,
            token: token,
          },
        );
        if (!readiness.isReady) {
          return NextResponse.redirect(
            new URL("/admin/settings?setup=required", req.url),
          );
        }
      }

      return NextResponse.redirect(
        new URL(
          getRoleHomePath(
            userRole.type,
            userRole.type === "admin" ? true : undefined,
          ),
          req.url,
        ),
      );
    } catch (error) {
      console.error("Error checking auth route status:", error);
      // Safe fallback for authenticated users
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  // Allow public routes (including sign-in and sign-up)
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to sign-in
  if (!isAuthenticated) {
    return redirectToSignIn({ returnBackUrl: req.url });
  }

  // For users visiting /onboarding, don't try to redirect
  if (isAuthenticated && isOnboardingRoute(req)) {
    return NextResponse.next();
  }

  // Fast path: Check session claims first (no API call)
  // If onboarding is complete according to Clerk, allow access and handle role-based routing
  if (sessionClaims?.metadata?.onboardingComplete) {
    // Onboarding is complete - proceed with role-based routing
    // Role is determined by Convex role field (manually set in dashboard)
    // Check Convex role for admin access
    try {
      const token = await getToken({ template: "convex" });
      if (token) {
        const userRole = await fetchQuery(
          api.auth.getUserRole,
          {},
          {
            url: process.env.NEXT_PUBLIC_CONVEX_URL!,
            token: token,
          },
        );

        if (userRole) {
          const role = userRole.type;

          let setupReady = true;
          if (role === "admin") {
            const readiness = await fetchQuery(
              api.setupReadiness.getPublicBookingReadiness,
              {},
              {
                url: process.env.NEXT_PUBLIC_CONVEX_URL!,
                token: token,
              },
            );
            setupReady = readiness.isReady;
          }

          const redirectPath = getProtectedRouteRedirect({
            pathname: url.pathname,
            role,
            isSetupReady: setupReady,
          });

          if (redirectPath) {
            return NextResponse.redirect(new URL(redirectPath, req.url));
          }

          if (isAdminRoute(req) || isCustomerRoute(req)) {
            return NextResponse.next();
          }
        }
      }
    } catch (error) {
      console.error("Error checking admin role:", error);
      // On error, deny admin access but allow dashboard
      if (isAdminRoute(req)) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }

    // If we have a valid onboarding status but the route doesn't match, allow access
    // (handles other protected routes that aren't admin/dashboard specific)
    return NextResponse.next();
  }

  // Fallback: Onboarding not complete or missing - check Convex
  // This handles new users who haven't completed onboarding yet
  try {
    const token = await getToken({ template: "convex" });

    if (!token) {
      const signInUrl = new URL("/sign-in", req.url);
      return NextResponse.redirect(signInUrl);
    }

    const userRole = await fetchQuery(
      api.auth.getUserRole,
      {},
      {
        url: process.env.NEXT_PUBLIC_CONVEX_URL!,
        token: token,
      },
    );

    // If userRole is null, the user doesn't exist in Convex
    // Redirect to onboarding to create the user record
    if (!userRole) {
      const onboardingUrl = new URL("/onboarding", req.url);
      return NextResponse.redirect(onboardingUrl);
    }

    // Check if user has completed onboarding in Convex (has address and vehicles)
    // This prevents existing admins from being re-onboarded
    const hasCompleted = await fetchQuery(
      api.users.hasCompletedOnboarding,
      {},
      {
        url: process.env.NEXT_PUBLIC_CONVEX_URL!,
        token: token,
      },
    );

    // If onboarding is complete in Convex, apply role-based routing and setup enforcement.
    if (hasCompleted) {
      let setupReady = true;
      if (userRole.type === "admin") {
        const readiness = await fetchQuery(
          api.setupReadiness.getPublicBookingReadiness,
          {},
          {
            url: process.env.NEXT_PUBLIC_CONVEX_URL!,
            token: token,
          },
        );
        setupReady = readiness.isReady;
      }

      const redirectPath = getProtectedRouteRedirect({
        pathname: url.pathname,
        role: userRole.type,
        isSetupReady: setupReady,
      });
      if (redirectPath) {
        return NextResponse.redirect(new URL(redirectPath, req.url));
      }

      return NextResponse.next();
    }

    // User exists but onboarding incomplete - redirect to onboarding
    const onboardingUrl = new URL("/onboarding", req.url);
    return NextResponse.redirect(onboardingUrl);
  } catch (error) {
    console.error("Error checking user role:", error);
    const signInUrl = new URL("/sign-in", req.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
