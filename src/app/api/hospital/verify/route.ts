import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  verificationTokens,
  users,
  hospitalProfiles,
  donorProfiles,
  recipientProfiles,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Force Node runtime (important for DB + auth)
export const runtime = "nodejs";

/* =========================
   GET: Email verification
========================= */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");
    const email = (searchParams.get("email") || "").toLowerCase();

    if (!token || !email) {
      return NextResponse.json({ error: "missing_params" }, { status: 400 });
    }

    const vt = await db.query.verificationTokens.findFirst({
      where: eq(verificationTokens.identifier, email),
    });

    if (!vt || vt.token !== token) {
      return NextResponse.json({ error: "invalid_token" }, { status: 400 });
    }

    if (new Date(vt.expires) < new Date()) {
      return NextResponse.json({ error: "token_expired" }, { status: 400 });
    }

    const owner = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!owner) {
      return NextResponse.json({ error: "no_user" }, { status: 404 });
    }

    await db
      .update(users)
      .set({ emailVerified: new Date() })
      .where(eq(users.id, owner.id));

    await db
      .update(hospitalProfiles)
      .set({ verified: true, updatedAt: new Date() })
      .where(eq(hospitalProfiles.userId, owner.id));

    await db
      .delete(verificationTokens)
      .where(eq(verificationTokens.identifier, email));

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      "http://localhost:3000";

    return NextResponse.redirect(
      `${appUrl}/onboarding/hospital/verified`
    );
  } catch (error) {
    console.error("Error verifying hospital email:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/* =========================
   POST: Verify donor/recipient
========================= */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "hospital") {
      return NextResponse.json(
        { error: "Hospital access required" },
        { status: 403 }
      );
    }

    const hospitalProfile = await db.query.hospitalProfiles.findFirst({
      where: eq(hospitalProfiles.userId, session.user.id),
    });

    if (!hospitalProfile) {
      return NextResponse.json(
        { error: "Hospital profile not found" },
        { status: 404 }
      );
    }

    const { profileId, profileType, action } = await request.json();

    if (!profileId || !profileType || !action) {
      return NextResponse.json(
        { error: "profileId, profileType and action required" },
        { status: 400 }
      );
    }

    if (action === "approve") {
      if (profileType === "donor") {
        await db
          .update(donorProfiles)
          .set({
            documentsVerified: true,
            verifiedByHospitalId: hospitalProfile.id,
            verifiedAt: new Date(),
          })
          .where(eq(donorProfiles.id, profileId));
      } else if (profileType === "recipient") {
        await db
          .update(recipientProfiles)
          .set({
            documentsVerified: true,
            verifiedByHospitalId: hospitalProfile.id,
            verifiedAt: new Date(),
            requestStatus: "verified",
          })
          .where(eq(recipientProfiles.id, profileId));
      }
    }

    if (action === "reject") {
      if (profileType === "donor") {
        await db
          .update(donorProfiles)
          .set({ documentsVerified: false })
          .where(eq(donorProfiles.id, profileId));
      } else if (profileType === "recipient") {
        await db
          .update(recipientProfiles)
          .set({
            documentsVerified: false,
            requestStatus: "rejected",
          })
          .where(eq(recipientProfiles.id, profileId));
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error verifying profile:", error);
    return NextResponse.json(
      { error: "Failed to verify profile" },
      { status: 500 }
    );
  }
}