export async function bootstrapVerifiedSessionWithApi(
  page,
  { email, password, displayName }
) {
  const apiBaseUrl = String(process.env.E2E_API_BASE_URL || process.env.E2E_BASE_URL || "")
    .trim()
    .replace(/\/$/u, "");
  if (!apiBaseUrl) {
    throw new Error("E2E API auth bootstrap requires E2E_API_BASE_URL");
  }
  const requestOrigin = String(
    process.env.E2E_API_REQUEST_ORIGIN || process.env.E2E_BASE_URL || apiBaseUrl
  )
    .trim()
    .replace(/\/$/u, "");
  const headers = {
    origin: requestOrigin,
    "x-debug-token-opt-in": "true",
  };
  const apiRequest = page.context().request;
  const registerResponse = await apiRequest.post(`${apiBaseUrl}/api/v1/auth/register`, {
    headers,
    data: {
      email,
      password,
      display_name: displayName,
      remember_me: true,
    },
  });
  if (!registerResponse.ok()) {
    throw new Error(`E2E API auth bootstrap registration failed (${registerResponse.status()})`);
  }
  const registration = await registerResponse.json();
  if (registration.status === "verification_required") {
    const verificationToken = String(registration.debug_verification_token || "").trim();
    if (!verificationToken) {
      throw new Error("E2E API auth bootstrap registration returned no verification token");
    }
    const verifyResponse = await apiRequest.post(`${apiBaseUrl}/api/v1/auth/verify-email`, {
      headers,
      data: {
        token: verificationToken,
        remember_me: true,
      },
    });
    if (!verifyResponse.ok()) {
      throw new Error(`E2E API auth bootstrap verification failed (${verifyResponse.status()})`);
    }
  } else if (registration.status !== "registered") {
    throw new Error("E2E API auth bootstrap returned an unsupported registration status");
  }
}
