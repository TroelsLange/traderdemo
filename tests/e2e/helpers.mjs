// Fælles hjælpere til browsertestene.
export async function server(request, opts = {}) {
  const res = await request.post("/__test", { data: { reset: true, ...opts } });
  if (!res.ok()) throw new Error("Testserveren svarer ikke");
}
// Sætter serverens og browserens klokke og åbner en fane.
export async function open(page, request, hash = "marked", opts = {}) {
  await server(request, opts);
  if (opts.now) await page.clock.setFixedTime(new Date(opts.now));
  await page.goto("/#" + hash);
  await page.waitForFunction(() => { const b = document.querySelector("#banner"); return b.hidden || !b.textContent.includes("Henter"); });
}
export const num = (s) => parseFloat(s.replace(/[^\d,−-]/g, "").replace("−", "-").replace(",", "."));
