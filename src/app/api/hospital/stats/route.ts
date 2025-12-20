import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { donorProfiles, recipientProfiles, matches, hospitalProfiles } from "@/lib/db/schema";
import { count, eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    
    if (!session?.user) {
      return NextResponse.json({ 
        totalVerified: 0,
        pendingReview: 0,
        activeMatches: 0,
        completedProcedures: 0
      });
    }
    
    // Return stats for everyone (they'll just see zeros if not hospital)

    // Get hospital profile
    const hospitalProfile = await db.query.hospitalProfiles.findFirst({
      where: eq(hospitalProfiles.userId, session.user.id),
    });

    if (!hospitalProfile) {
      return NextResponse.json({ error: "Hospital profile not found" }, { status: 404 });
    }

    // Get real statistics
    const [
      totalVerifiedDonors,
      totalVerifiedRecipients,
      pendingDonors,
      pendingRecipients,
      activeMatchesCount,
      completedMatchesCount,
    ] = await Promise.all([
      db.select({ count: count() }).from(donorProfiles).where(eq(donorProfiles.documentsVerified, true)),
      db.select({ count: count() }).from(recipientProfiles).where(eq(recipientProfiles.documentsVerified, true)),
      db.select({ count: count() }).from(donorProfiles).where(eq(donorProfiles.documentsVerified, false)),
      db.select({ count: count() }).from(recipientProfiles).where(eq(recipientProfiles.documentsVerified, false)),
      db.select({ count: count() }).from(matches).where(eq(matches.status, "matched")),
      db.select({ count: count() }).from(matches).where(eq(matches.status, "completed")),
    ]);

    const totalVerified = (totalVerifiedDonors[0]?.count || 0) + (totalVerifiedRecipients[0]?.count || 0);
    const pendingReview = (pendingDonors[0]?.count || 0) + (pendingRecipients[0]?.count || 0);
    const activeMatches = activeMatchesCount[0]?.count || 0;
    const completedProcedures = completedMatchesCount[0]?.count || 0;

    return NextResponse.json({
      totalVerified,
      pendingReview,
      activeMatches,
      completedProcedures,
    });
  } catch (error) {
    console.error("Error fetching hospital stats:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
