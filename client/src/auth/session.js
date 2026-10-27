export function getAuthSession(responseBody) {
  const session = responseBody?.data;
  if (
    !session ||
    typeof session.accessToken !== "string" ||
    !session.user ||
    typeof session.user !== "object"
  ) {
    throw new Error("The authentication service returned an invalid session.");
  }
  return session;
}
