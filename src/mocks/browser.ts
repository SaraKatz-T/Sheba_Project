import { FetchInterceptor } from '@mswjs/interceptors/fetch'
import { WebSocketInterceptor } from '@mswjs/interceptors/WebSocket'
import { XMLHttpRequestInterceptor } from '@mswjs/interceptors/XMLHttpRequest'
import { InterceptorSource, defineNetwork } from 'msw/experimental'
import { handlers } from './handlers'

/**
 * Runs the mock inside the page by patching fetch, XHR and WebSocket, not in a
 * Service Worker. The browser may stop an idle Service Worker (for example while the
 * tab sits in the background); a restarted worker forgets the tab and lets every
 * request through to the dev server, which answers 404. In-page interception has no
 * such lifecycle.
 */
export async function startMockServer() {
  await removeLegacyWorker()
  const network = defineNetwork({
    sources: [
      new InterceptorSource({
        interceptors: [new FetchInterceptor(), new XMLHttpRequestInterceptor(), new WebSocketInterceptor()],
      }),
    ],
    handlers,
    onUnhandledFrame: 'bypass',
    context: { quiet: true },
  })
  await network.enable()
}

/** Earlier builds registered mockServiceWorker.js; drop it so it cannot interfere. */
async function removeLegacyWorker() {
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? []
    await Promise.all(
      registrations
        .filter((r) => (r.active ?? r.waiting ?? r.installing)?.scriptURL.endsWith('/mockServiceWorker.js'))
        .map((r) => r.unregister()),
    )
  } catch {
    // Service workers unavailable; nothing to clean up.
  }
}
