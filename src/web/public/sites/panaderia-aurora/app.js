document.getElementById("year").textContent = new Date().getFullYear();

const navToggle = document.getElementById("navToggle");
const navLinks = document.getElementById("navLinks");

navToggle.addEventListener("click", () => {
  const isOpen = navLinks.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

document.querySelectorAll("#navLinks a").forEach((a) => {
  a.addEventListener("click", () => {
    navLinks.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  });
});

const form = document.getElementById("orderForm");
const hint = document.getElementById("formHint");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(form);

  const name = String(data.get("name") || "").trim();
  const phone = String(data.get("phone") || "").trim();
  const order = String(data.get("order") || "").trim();

  const message = `Pedido (demo):\n- Nombre: ${name}\n- Tel: ${phone}\n- Pedido: ${order}`;

  try {
    await navigator.clipboard.writeText(message);
    hint.textContent = "Pedido generado y copiado al portapapeles.";
  } catch {
    hint.textContent = "Pedido generado (demo). Mira la consola para copiarlo.";
  }

  console.log(message);
});
