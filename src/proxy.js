addEventListener('fetch', event => {
  event.respondWith(handleFetch(event.request));
});

async function handleFetch(request) {
  // Construct the GitHub Pages URL based on the incoming request path and query
  const url = new URL(request.url);
  const githubPagesUrl = `https://melodylumen.github.io${url.pathname}${url.search}`;

  // Proxy the request to GitHub Pages
  const response = await fetch(githubPagesUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'follow'
  });

  // Optionally, you can add or modify headers here
  return new Response(response.body, response);
}

