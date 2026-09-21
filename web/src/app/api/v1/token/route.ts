import { handler, ok, readJson } from "@/lib/api";
import { GatewayError } from "@/lib/denis/client";
import { authenticateApiKey, issueTokens, verifyRefreshToken } from "@/lib/api-keys";

/**
 * Exchange an API key for a short-lived access JWT and a refresh JWT:
 *   POST /api/v1/token { "apiKey": "dk_..." }        -> { accessToken, refreshToken, expiresIn, tokenType }
 *   POST /api/v1/token { "refreshToken": "..." }      -> a new pair
 * Access tokens are accepted wherever an API key is (Bearer). Revoking the key invalidates both.
 */
export const POST = handler(async (request: Request) => {
  const body = await readJson<{ apiKey?: string; refreshToken?: string }>(request);
  const principal = body.refreshToken
    ? await verifyRefreshToken(String(body.refreshToken))
    : body.apiKey
      ? await authenticateApiKey(String(body.apiKey))
      : null;
  if (!principal) throw new GatewayError("Invalid credential", 401, "UNAUTHORIZED");
  return ok(await issueTokens(principal));
});
