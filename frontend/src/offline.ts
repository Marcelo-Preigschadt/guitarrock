// Codespaces authenticates navigation at the forwarding proxy. Keep its
// redirects under the browser's control, outside the offline fetch handler.
export async function configureOfflineCaching(base: string) {
  if (!("serviceWorker" in navigator)) return;
  const workerUrl = new URL("sw.js", new URL(base, location.href));
  if (location.hostname.endsWith(".app.github.dev")) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter((registration) =>
      [registration.active, registration.waiting, registration.installing]
        .some((worker) => worker?.scriptURL === workerUrl.href),
    ).map((registration) => registration.unregister()));
    return;
  }
  const registration = await navigator.serviceWorker.register(workerUrl.href, {
    updateViaCache: "none",
  });
  await registration.update();
}
