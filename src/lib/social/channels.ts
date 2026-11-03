import { METRICS_FETCHERS as BASE_METRICS, PUBLISHERS as BASE_PUBLISHERS, testPlatform as testBasePlatform, type PublishDeps } from "./publish";
import { MORE_METRICS, MORE_PUBLISHERS, testMorePlatform } from "./publish-more";
import type { Connection } from "./accounts";

/** Every publishing platform in one place. */
export const PUBLISHERS = { ...BASE_PUBLISHERS, ...MORE_PUBLISHERS };
export const METRICS_FETCHERS = { ...BASE_METRICS, ...MORE_METRICS };

/** Platforms that need the slideshow video. */
export const VIDEO_PLATFORMS = ["youtube", "tiktok"];
/** Platforms that publish a long-form article. */
export const BLOG_PLATFORMS = ["wordpress", "blogger", "devto", "hashnode"];

export async function testPlatform(d: PublishDeps, platform: string, conn: Connection) {
  return (await testMorePlatform(d, platform, conn)) ?? testBasePlatform(d, platform, conn);
}
