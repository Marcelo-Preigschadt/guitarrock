"""A recovery document reachable outside the installed offline worker's routes."""

RECOVERY_HTML = r'''<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#101214">
  <title>Recuperar acesso · RiffSync</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#101214;color:#e9edf0;font:16px/1.7 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
    main{max-width:620px;width:100%;background:#191d20;border:1px solid #343c42;border-radius:16px;padding:32px}
    small{color:#c5f16d;letter-spacing:2px}h1{font-size:28px;line-height:1.3;margin:16px 0}p{color:#adb8c1;margin:12px 0}
    button{font:600 16px system-ui,sans-serif;padding:14px 20px;border:0;border-radius:8px;background:#c5f16d;color:#233014;cursor:pointer;margin-top:14px}
    button:disabled{opacity:.6;cursor:wait}button:focus-visible{outline:2px solid white;outline-offset:4px}
    #status{white-space:pre-wrap;overflow-wrap:anywhere;border-top:1px solid #343c42;padding-top:18px;margin-top:24px;font-size:14px}
    #status[data-error]{color:#ffc4a5}
  </style>
</head>
<body>
  <main>
    <small>RIFFSYNC</small>
    <h1>Vamos recuperar seu estúdio.</h1>
    <p>Renove o cache da interface e verifique os arquivos necessários para abrir o aplicativo.</p>
    <p>Suas músicas, projetos, timbres e sincronizações ficam preservados neste navegador.</p>
    <button id="recover" type="button">Recuperar e abrir estúdio</button>
    <div id="status" role="status" aria-live="polite">Pronto para verificar o acesso.</div>
  </main>
  <script>
    const button = document.getElementById('recover');
    const status = document.getElementById('status');
    const options = {cache:'no-store',credentials:'same-origin'};
    async function checked(path, kind) {
      const response = await fetch(path, {...options,signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error(kind + ': HTTP ' + response.status);
      const type = response.headers.get('content-type') || '';
      if (kind === 'Interface' && !type.includes('text/html')) throw new Error('A página inicial não retornou HTML.');
      if (kind.endsWith('.js') && !/javascript|ecmascript/.test(type)) throw new Error(kind + ': o servidor devolveu uma página no lugar do JavaScript.');
      if (kind.endsWith('.css') && !type.includes('text/css')) throw new Error(kind + ': o servidor devolveu uma página no lugar do CSS.');
      return response;
    }
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.removeAttribute('data-error');
      status.textContent = 'Renovando o cache da interface…';
      try {
        if ('serviceWorker' in navigator) {
          for (const registration of await navigator.serviceWorker.getRegistrations()) {
            const owned = [registration.active,registration.waiting,registration.installing]
              .some(worker => worker && worker.scriptURL === new URL('/sw.js',location.href).href);
            if (owned) await registration.unregister();
          }
        }
        if ('caches' in window) {
          const names = await caches.keys();
          await Promise.all(names.filter(name => name.startsWith('riffsync-')).map(name => caches.delete(name)));
        }
        status.textContent = 'Verificando o servidor…';
        const health = await (await checked('/api/health','Servidor')).json();
        if (health.status !== 'ok') throw new Error('O servidor não confirmou a disponibilidade.');
        status.textContent = 'Servidor ' + health.version + ' respondeu. Verificando a interface…';
        const page = await checked('/','Interface');
        const html = await page.text();
        const doc = new DOMParser().parseFromString(html,'text/html');
        const assets = [...doc.querySelectorAll('script[type="module"][src],link[rel="stylesheet"][href]')];
        if (!doc.getElementById('root') || !assets.length) throw new Error('O endereço retornou uma página diferente do RiffSync.');
        for (const asset of assets) {
          const url = new URL(asset.getAttribute('src') || asset.getAttribute('href'),new URL('/',location.href));
          if (url.origin !== location.origin || !url.pathname.startsWith('/assets/')) throw new Error('O build aponta para um arquivo de interface inesperado.');
          status.textContent = 'Verificando ' + url.pathname.split('/').pop() + '…';
          await checked(url.href,url.pathname.split('/').pop());
        }
        status.textContent = 'Interface verificada. Abrindo seu estúdio…';
        location.replace('/?recuperado=' + Date.now());
      } catch (error) {
        status.setAttribute('data-error','');
        status.textContent = 'A recuperação encontrou este erro:\n' + (error.message || String(error)) + '\nEnvie um print desta mensagem.';
        button.disabled = false;
      }
    });
  </script>
</body>
</html>'''
