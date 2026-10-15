/* QZ SPA navigation — keeps the existing quiz pages and their features. */
(() => {
  if (window.__QZ_SPA_INSTALLED__) return;
  window.__QZ_SPA_INSTALLED__ = true;

  const routerScript = document.currentScript;
  const currentUrl = () => new URL(location.href);

  function isInternalPageLink(anchor) {
    if (!anchor || !anchor.href || anchor.hasAttribute("download")) return false;
    if (anchor.target && anchor.target !== "_self") return false;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) return false;
    if (!/\.html?$/i.test(url.pathname) && url.pathname !== new URL("./", location.href).pathname) return false;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return false;
    return true;
  }

  function setHead(nextDoc, destination) {
    const keep = routerScript || document.querySelector('script[data-qz-spa-router]');
    [...document.head.children].forEach(node => {
      if (node !== keep) node.remove();
    });
    [...nextDoc.head.children].forEach(node => {
      if (node.tagName === "SCRIPT" && (node === nextDoc.querySelector('script[src*="qz-spa.js"]') || node.hasAttribute("data-qz-spa-router"))) return;
      const copy = document.importNode(node, true);
      if (copy.tagName === "LINK" && copy.getAttribute("href")) copy.href = new URL(copy.getAttribute("href"), destination).href;
      if (copy.tagName === "BASE") return;
      document.head.appendChild(copy);
    });
    if (keep && !keep.isConnected) document.head.appendChild(keep);
    document.title = nextDoc.title || "QZ — Think fast. Prove it.";
  }

  function copyBodyAttributes(nextBody) {
    [...document.body.attributes].forEach(attr => document.body.removeAttribute(attr.name));
    [...nextBody.attributes].forEach(attr => document.body.setAttribute(attr.name, attr.value));
  }

  async function runPageScripts(nextBody, destination) {
    const scripts = [...nextBody.querySelectorAll("script")];
    for (const oldScript of scripts) {
      const script = document.createElement("script");
      for (const attr of oldScript.attributes) {
        if (attr.name === "src") script.src = new URL(attr.value, destination).href;
        else script.setAttribute(attr.name, attr.value);
      }
      if (oldScript.src) script.src = new URL(oldScript.getAttribute("src"), destination).href;
      script.textContent = oldScript.textContent;
      if (!script.type || script.type === "text/javascript" || script.type === "application/javascript") {
        // Scope classic scripts so page-specific const/let declarations don't collide on later visits.
        script.textContent = "(function(){\n" + script.textContent + "\n}).call(window);";
      }
      if (script.src || script.type === "module") {
        await new Promise((resolve, reject) => {
          script.addEventListener("load", resolve, { once: true });
          script.addEventListener("error", () => reject(new Error("A page script failed to load")), { once: true });
          document.body.appendChild(script);
        });
      } else {
        document.body.appendChild(script);
      }
    }
  }

  let navigationId = 0;
  async function navigate(to, { push = true, scroll = true } = {}) {
    const destination = new URL(to, location.href);
    if (destination.origin !== location.origin) {
      location.assign(destination.href);
      return;
    }
    const id = ++navigationId;
    document.documentElement.classList.add("qz-spa-loading");
    document.dispatchEvent(new CustomEvent("qz:before-navigate", { detail: { url: destination.href } }));
    try {
      const response = await fetch(destination.href, { headers: { "X-QZ-Navigation": "spa" } });
      if (!response.ok) throw new Error("Page request failed");
      const html = await response.text();
      const nextDoc = new DOMParser().parseFromString(html, "text/html");
      if (!nextDoc.body || id !== navigationId) return;
      if (push) history.pushState({ qzSpa: true }, "", destination.href);
      setHead(nextDoc, destination);
      copyBodyAttributes(nextDoc.body);
      document.body.replaceChildren(...[...nextDoc.body.childNodes].map(node => document.importNode(node, true)));
      await runPageScripts(document.body, destination);
      if (id !== navigationId) return;
      if (destination.hash) {
        requestAnimationFrame(() => document.getElementById(decodeURIComponent(destination.hash.slice(1)))?.scrollIntoView());
      } else if (scroll) {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
      document.dispatchEvent(new CustomEvent("qz:after-navigate", { detail: { url: destination.href } }));
    } catch (error) {
      console.warn("QZ SPA navigation fell back to a full page load.", error);
      location.assign(destination.href);
    } finally {
      if (id === navigationId) document.documentElement.classList.remove("qz-spa-loading");
    }
  }

  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest("a");
    if (!isInternalPageLink(anchor)) return;
    const destination = new URL(anchor.href, location.href);
    if (destination.pathname === location.pathname && destination.search === location.search && destination.hash) return;
    event.preventDefault();
    navigate(destination.href);
  });

  window.addEventListener("popstate", () => navigate(currentUrl().href, { push: false, scroll: false }));
  document.documentElement.classList.add("qz-spa-enabled");
  const style = document.createElement("style");
  style.textContent = ".qz-spa-loading body{opacity:.72;transition:opacity .12s ease}.qz-spa-enabled body{transition:opacity .12s ease}@media(prefers-reduced-motion:reduce){.qz-spa-enabled body{transition:none}}";
  document.head.appendChild(style);
})();
