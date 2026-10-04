import { loadDeviceCredential } from '@/vault/secure';

const API = process.env.EXPO_PUBLIC_PLAID_API_URL ?? 'http://127.0.0.1:8787';

/** Best-effort. Erase continues when the sidecar is unreachable. P3 owns the real enrollment. */
export async function deleteEnrolledDevice(): Promise<void> {
  const credential = await loadDeviceCredential();
  if (!credential) return;
  const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(5000) : undefined;
  await fetch(`${API}/device/delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': credential.deviceId,
      Authorization: `Bearer ${credential.secret}`,
    },
    signal,
  });
}
