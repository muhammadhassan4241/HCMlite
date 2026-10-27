export function getLoginErrorMessage(requestError) {
  const error = requestError.response?.data?.error;

  if (error?.code === "INVALID_CREDENTIALS") {
    return "Email or password is incorrect. Check your credentials and try again.";
  }
  if (error?.code === "INVALID_INPUT") {
    return "Enter a valid email address and password.";
  }
  if (!requestError.response) {
    return "Cannot reach the HCM Lite API. Check your connection and try again.";
  }
  if (requestError.response.status >= 500) {
    return "Sign-in is temporarily unavailable. Please try again later.";
  }
  if (requestError.response.status === 404) {
    return "The sign-in service is unavailable. Please try again later.";
  }
  return "Unable to sign in. Please check your details and try again.";
}
