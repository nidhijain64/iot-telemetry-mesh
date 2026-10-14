// Keep REST and MQTT identities scoped to the same browser tab.
const TOKEN_KEY = 'iot_dashboard_token';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}
