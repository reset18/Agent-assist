(() => {
  const $ = (sel) => document.querySelector(sel);

  // Año footer
  const year = new Date().getFullYear();
  const yearEl = $("#year");
  if (yearEl) yearEl.textContent = String(year);

  // Menú móvil
  const toggle = $("#navToggle");
  const menu = $("#navMenu");
  if (toggle && menu) {
    toggle.addEventListener("click", () => {
      const open = menu.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });

    menu.addEventListener("click", (e) => {
      const target = e.target;
      if (target && target.tagName === "A") {
        menu.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  // WhatsApp link + generador de mensaje
  const WHATSAPP_NUMBER = "34600123123"; // Cambia esto si quieres
  const whatsLink = $("#whatsLink");
  if (whatsLink) {
    const base = `https://wa.me/${WHATSAPP_NUMBER}`;
    whatsLink.href = `${base}?text=${encodeURIComponent("Hola, quiero hacer un pedido.")}`;
  }

  const form = $("#pedidoForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const fd = new FormData(form);
      const nombre = (fd.get("nombre") || "").toString().trim();
      const producto = (fd.get("producto") || "").toString().trim();
      const fecha = (fd.get("fecha") || "").toString().trim();
      const detalles = (fd.get("detalles") || "").toString().trim();

      if (!nombre || !producto || !fecha) {
        alert("Por favor, completa nombre, producto y fecha.");
        return;
      }

      const msg = [
        `Hola, soy ${nombre}.`,
        `Me gustaría pedir: ${producto}.`,
        `Para el día: ${fecha}.`,
        detalles ? `Detalles: ${detalles}` : "",
        "Gracias!"
      ].filter(Boolean).join("\n");

      const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    });
  }
})();
