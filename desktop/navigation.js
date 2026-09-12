/**
 * Where the embedded web app may go, and what counts as a sign-in.
 *
 * Kept apart from main.js, which cannot even be loaded without Electron, so
 * these rules can be checked with plain Node.
 */

/**
 * Is this URL the app itself?
 *
 * Compared as an origin, not a string prefix: `https://app.followthroo.com.example.net`
 * starts with the app's address and is somebody else's site. The embedded view
 * has no preload, but it is still a window with our name across the top.
 */
function isAppUrl(rawUrl, appOrigin) {
  try {
    return new URL(rawUrl).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

/**
 * The providers behind the web app's "Sign in with …" buttons.
 *
 * Google checks the user agent and refuses Electron outright. Zoho might work
 * in place, but one flow that always works beats two that mostly do — the same
 * reasoning `startExternalSignIn` in main.js gives.
 */
const PROVIDER_HOSTS = [/^accounts\.google\.com$/i, /^accounts\.zoho(cloud)?\.[a-z.]+$/i];

/**
 * Is this navigation a Google or Zoho sign-in starting?
 *
 * The web app's buttons send the whole page to the provider. Handing that exact
 * URL to the system browser signs the *browser* in and leaves this app signed
 * out: the state cookie lives here, and the provider returns to /dashboard, not
 * to /desktop-auth — the only page that hands a session back. So a match means
 * "start the handoff", never "open this URL".
 */
function isProviderSignIn(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  return url.protocol === "https:" && PROVIDER_HOSTS.some((re) => re.test(url.hostname));
}

module.exports = { isAppUrl, isProviderSignIn };
