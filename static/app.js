"use strict";

const view = document.getElementById("view");
let meta = null;
let renderToken = 0;

/* Hilfsfunktionen */

function setView(...nodes) {
  view.replaceChildren(...nodes.filter(Boolean));
}

// Baut DOM-Elemente. Inhalte werden immer als Text gesetzt, nie als HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (key === "value") el.value = value;
    else if (key === "checked" || key === "selected" || key === "disabled" || key === "required") el[key] = Boolean(value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child.nodeType ? child : String(child));
  }
  return el;
}

async function api(path, method = "GET", body) {
  const options = { method };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new Error("Der CRM-Server antwortet nicht. Läuft er noch?");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.login) {
    showLogin();
    throw new Error("Bitte neu anmelden.");
  }
  if (!res.ok) throw new Error(data.error || "Das hat nicht geklappt.");
  return data;
}

/* Anmeldung (nur im Server-Modus, wenn das CRM unterwegs erreichbar ist) */

let authMode = "lokal";
function showLogin(message) {
  document.body.classList.add("logged-out");
  const email = h("input", { type: "email", autocomplete: "username", required: true });
  const password = h("input", { type: "password", autocomplete: "current-password", required: true });
  const code = h("input", { inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9 ]*", maxlength: 7, placeholder: "6 Ziffern" });
  const error = h("p", { class: "error", hidden: !message }, message || "");
  const submit = h("button", { class: "btn", type: "submit" }, "Anmelden");
  setView(h("div", { class: "login" },
    h("img", { src: "favicon.svg", alt: "", class: "login-mark" }),
    h("h1", {}, "Meerkötter CRM"),
    h("form", {
      class: "form",
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        error.hidden = true;
        try {
          const res = await fetch("/auth/login", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.value, password: password.value, code: code.value }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Anmeldung fehlgeschlagen.");
          location.reload();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          password.value = "";
          code.value = "";
          submit.disabled = false;
        }
      },
    },
      field("E-Mail", email),
      field("Passwort", password),
      field("Code aus der Authenticator-App", code),
      error,
      submit),
    h("p", { class: "small muted" }, "Nach 8 Stunden ohne Aktivität wirst du automatisch abgemeldet.")));
  setTimeout(() => email.focus(), 50);
}

async function logout() {
  await fetch("/auth/logout", { method: "POST" }).catch(() => {});
  location.hash = "#/";
  location.reload();
}

let toastTimer;
function toast(message, bad = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.toggle("bad", bad);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, bad ? 6000 : 2500);
}

// Führt eine Aktion aus und zeigt Fehler sichtbar an.
async function attempt(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
    return undefined;
  }
}

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const euro = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const euroCents = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });
function money(value) {
  return value === null || value === undefined ? "–" : euro.format(value);
}
function personName(c) {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "Ohne Namen";
}
function personLink(c, id = c.id) {
  return h("a", { class: "name", href: `#/kontakt/${id}` }, personName(c));
}
function companyLink(id, name) {
  return h("a", { class: "name", href: `#/firma/${id}` }, name);
}
// Verlinkt die Firma oder Person, zu der ein Eintrag gehört.
function ownerLink(row) {
  return row.company_id
    ? companyLink(row.company_id, row.company_name)
    : personLink(row, row.contact_id);
}
// Bereichsfilter Firma / Privat aus der Kopfzeile. Gilt für Übersicht, Personen und Pipeline.
const AREA_KEY = "crm-bereich";
let area = "";
try { area = localStorage.getItem(AREA_KEY) || ""; } catch { /* ohne gespeicherte Wahl */ }
if (!["", "firma", "privat"].includes(area)) area = "";
function areaParam(prefix = "?") {
  return area ? `${prefix}bereich=${area}` : "";
}
function initAreaFilter() {
  const buttons = [...document.querySelectorAll("#area-filter [data-area]")];
  const sync = () => buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.area === area)));
  buttons.forEach((b) => b.addEventListener("click", () => {
    area = b.dataset.area;
    try { localStorage.setItem(AREA_KEY, area); } catch { /* nur für diese Sitzung */ }
    sync();
    route();
  }));
  sync();
}
function areaTag(value) {
  return value ? h("span", { class: `tag-area ${value}` }, meta.areas[value] || value) : null;
}
function areaNote() {
  return area ? h("p", { class: "areanote" }, `Gefiltert auf ${meta.areas[area]}. Umschalten oben in der Leiste.`) : null;
}
function householdTag(c) {
  return c.household_id ? h("a", { class: "tag-house", href: `#/privatkunden?haushalt=${c.household_id}`, title: "Alle Personen dieses Haushalts" },
    `Haushalt ${c.household_name}`) : null;
}
// Eingabefeld mit Vorschlagsliste für Personen. Liefert das Feld und eine Funktion für die gewählte ID.
function personPicker(people, exclude) {
  const listId = `personen-${Math.random().toString(36).slice(2)}`;
  const labelOf = (p) => `${personName(p)}${p.company_names ? ` (${p.company_names})` : p.household_name ? ` (Haushalt ${p.household_name})` : ""} #${p.id}`;
  const options = people.filter((p) => p.id !== exclude);
  const input = h("input", { list: listId, autocomplete: "off", placeholder: "Name eintippen und aus der Liste wählen" });
  const list = h("datalist", { id: listId }, options.map((p) => h("option", { value: labelOf(p) })));
  const chosen = () => {
    const match = /#(\d+)$/.exec(input.value.trim());
    return match && options.some((p) => p.id === Number(match[1])) ? Number(match[1]) : null;
  };
  return { field: h("div", {}, input, list), input, chosen };
}
function badge(status) {
  const slug = status.toLowerCase().replace(/\s+/g, "-").replace("ä", "ae").replace("ü", "ue");
  return h("span", { class: `badge badge-${slug}` }, status);
}
function gradeBadge(grade, title) {
  return grade ? h("span", { class: `grade grade-${grade.toLowerCase()}`, title: title || `Einstufung ${grade}` }, grade) : null;
}
function selectEl(options, value, attrs = {}) {
  return h("select", attrs, options.map((o) => {
    const [val, label] = Array.isArray(o) ? o : [o, o];
    return h("option", { value: val, selected: String(val) === String(value ?? "") }, label);
  }));
}
function section(title, ...content) {
  return h("section", { class: "card" }, h("h2", {}, title), ...content);
}
function pageHead(kicker, title, ...actions) {
  return h("div", { class: "pagehead" },
    h("div", {}, h("span", { class: "kicker" }, kicker), h("h1", {}, title)),
    actions.length ? h("div", { class: "head-actions" }, actions) : null);
}
function field(label, input) {
  return h("label", {}, label, input);
}
// PLZ und Ort aus der Anschrift, zum Beispiel „2020 Hollabrunn“.
function placeOf(address) {
  const match = /(?:^|[\s,])(\d{4,5})\s+([^,\d][^,]*?)\s*$/.exec(address || "");
  return match ? `${match[1]} ${match[2]}` : "";
}
function telLink(number) {
  return number ? h("a", { href: `tel:${number.replace(/[^\d+]/g, "")}` }, number) : "";
}
function facts(rows) {
  return h("dl", { class: "facts" }, rows.filter(([, value]) => value).map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
}

/* Dialoge */

function openDialog(title, buildBody, onClosed) {
  const dialog = h("dialog", {});
  let finished = false;
  // Das close-Ereignis kommt nur bei Esc zwingend und kann verzögert sein, daher auch direkt aufräumen.
  const finish = () => {
    if (finished) return;
    finished = true;
    dialog.remove();
    if (onClosed) onClosed();
  };
  const close = () => { dialog.close(); finish(); };
  dialog.addEventListener("close", finish);
  dialog.append(h("div", { class: "dialog-body" }, h("h2", {}, title), buildBody(close)));
  document.body.append(dialog);
  dialog.showModal();
}

function confirmDialog(title, text, actionLabel) {
  return new Promise((resolve) => {
    let result = false;
    openDialog(title, (close) => h("div", { class: "form" },
      h("p", { class: "prewrap" }, text),
      h("div", { class: "form-end" },
        h("button", { class: "btn btn-ghost", type: "button", onclick: close }, "Abbrechen"),
        h("button", { class: "btn btn-danger", type: "button", onclick: () => { result = true; close(); } }, actionLabel))),
      () => resolve(result));
  });
}

// Formular mit Fehleranzeige und den Knöpfen Abbrechen und Speichern.
function dialogForm(close, submit, ...fields) {
  const error = h("p", { class: "error", hidden: true });
  return h("form", {
    class: "form",
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await submit();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    },
  },
    fields,
    error,
    h("div", { class: "form-end" },
      h("button", { class: "btn btn-ghost", type: "button", onclick: close }, "Abbrechen"),
      h("button", { class: "btn", type: "submit" }, "Speichern")));
}

function readInputs(inputs) {
  const data = {};
  for (const [key, input] of Object.entries(inputs)) {
    data[key] = input.type === "checkbox" ? input.checked : input.value;
  }
  return data;
}

// Quelle mit Empfehler: Der Empfehler ist nur bei „Empfehlung“ sichtbar.
function sourceFields(record, inputs, referrers) {
  inputs.source = selectEl([["", "Keine Angabe"], ...meta.sources], record.source || "");
  inputs.referrer_id = selectEl(
    [["", "Noch nicht zugeordnet"], ...referrers.map((r) => [r.id, r.name])], record.referrer_id || "");
  const addReferrer = h("button", {
    class: "btn btn-ghost", type: "button",
    onclick: () => referrerDialog(null, (saved) => {
      inputs.referrer_id.append(h("option", { value: saved.id }, saved.name));
      inputs.referrer_id.value = saved.id;
    }),
  }, "Neu");
  const referrerRow = h("div", { class: "pickrow" },
    field("Empfehlungsgeber", inputs.referrer_id), addReferrer);
  const sync = () => { referrerRow.hidden = inputs.source.value !== meta.referralSource; };
  inputs.source.addEventListener("change", sync);
  sync();
  return { source: field("Quelle", inputs.source), referrer: referrerRow };
}

// Zeigt beim Tippen mögliche Dubletten und bremst das Anlegen bei sehr wahrscheinlichen Doppeln.
function duplicateWatch(kind, inputs, keys, record, close) {
  const box = h("div", { class: "dupes", hidden: true });
  const confirm = h("input", { type: "checkbox" });
  const confirmRow = h("label", { class: "check", hidden: true }, confirm, "Trotzdem neu anlegen, es ist ein anderer Eintrag");
  const creating = !record;
  let timer;
  let latest = [];
  let request = 0;

  async function load() {
    const params = new URLSearchParams({ kind });
    for (const key of keys) if (inputs[key]?.value.trim()) params.set(key, inputs[key].value.trim());
    if (record) params.set("exclude", record.id);
    if ([...params.keys()].length <= (record ? 2 : 1)) return [];
    return api(`/api/similar?${params}`);
  }

  function draw(matches) {
    latest = matches;
    const strong = matches.some((m) => m.strong);
    box.hidden = !matches.length;
    confirmRow.hidden = !(creating && strong);
    if (!strong) confirm.checked = false;
    const path = kind === "company" ? "firma" : "kontakt";
    box.replaceChildren(
      h("div", { class: "dupes-title" }, strong ? "Diesen Eintrag gibt es wahrscheinlich schon:" : "Ähnliche Einträge im CRM:"),
      h("ul", {}, matches.map((m) => h("li", { class: m.strong ? "strong" : "" },
        h("a", { href: `#/${path}/${m.id}`, onclick: () => close() }, m.label),
        h("span", { class: "small muted" }, [m.sub, m.reasons.join(", ")].filter(Boolean).join(" · "))))));
  }

  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++request;
      try {
        const matches = await load();
        if (mine === request) draw(matches);
      } catch { /* Hinweis ist nur eine Hilfe */ }
    }, 300);
  };
  for (const key of keys) inputs[key]?.addEventListener("input", refresh);
  if (record) refresh();

  // Vor dem Speichern frisch prüfen: neue Einträge mit starkem Treffer nur nach Bestätigung.
  async function guard() {
    if (!creating) return;
    const matches = await load();
    draw(matches);
    if (matches.some((m) => m.strong) && !confirm.checked) {
      throw new Error("Diesen Eintrag gibt es wahrscheinlich schon. Öffne den vorhandenen oder bestätige „Trotzdem neu anlegen“.");
    }
  }
  return { box, confirmRow, guard };
}

async function contactDialog(contact, onSaved, preset = {}) {
  const [companies, referrers, households] = await Promise.all([api("/api/companies"), api("/api/referrers"), api("/api/households")]);
  const c = contact || { status: "Potential", consent: "Offen", private: !preset.company_id, ...preset };
  const inputs = {};
  const text = (name, attrs = {}) => (inputs[name] = h("input", { value: c[name] || "", autocomplete: "off", ...attrs }));

  openDialog(contact ? "Person bearbeiten" : "Neue Person", (close) => {
    inputs.private = h("input", { type: "checkbox", checked: Boolean(c.private) });
    inputs.status = selectEl(meta.statuses, c.status || "Potential");
    inputs.consent = selectEl(meta.consents, c.consent || "Offen");
    const source = sourceFields(c, inputs, referrers);
    const houseList = h("datalist", { id: "haushalte" }, households.map((x) => h("option", { value: x.name })));
    inputs.household = h("input", { value: c.household_name || "", list: "haushalte", autocomplete: "off", placeholder: "zum Beispiel Familie Muster" });

    const privateBlock = h("div", { class: "form" },
      h("div", { class: "form-row" }, field("Status als Privatkunde", inputs.status), source.source),
      source.referrer);
    const syncPrivate = () => { privateBlock.hidden = !inputs.private.checked; };
    inputs.private.addEventListener("change", syncPrivate);
    syncPrivate();

    // Beim Anlegen gleich mit einer Firma verbinden; weitere Firmen auf der Personenseite.
    let linkPart = null;
    if (!contact) {
      inputs.company_id = selectEl([["", "Keine Firma"], ...companies.map((o) => [o.id, o.name])], preset.company_id || "");
      inputs.link_kind = selectEl(meta.linkKinds, "Ansprechpartner/in");
      inputs.is_primary = h("input", { type: "checkbox" });
      const linkBlock = h("div", { class: "form" },
        h("div", { class: "form-row" }, field("Rolle in der Firma", inputs.link_kind),
          field("Funktion", text("role", { placeholder: "zum Beispiel Geschäftsführer" }))),
        h("label", { class: "check" }, inputs.is_primary, "Hauptansprechperson dieser Firma"));
      const syncLink = () => { linkBlock.hidden = !inputs.company_id.value; };
      inputs.company_id.addEventListener("change", syncLink);
      syncLink();
      linkPart = [field("Firma", inputs.company_id), linkBlock];
    }
    let dupes = null;

    const form = dialogForm(close, async () => {
      await dupes.guard();
      const data = readInputs(inputs);
      const saved = contact
        ? await api(`/api/contacts/${contact.id}`, "PUT", data)
        : await api("/api/contacts", "POST", data);
      close();
      onSaved(saved);
    },
      h("div", { class: "form-row" }, field("Vorname", text("first_name")), field("Nachname", text("last_name"))),
      h("div", { class: "dupes-slot" }),
      linkPart,
      h("div", { class: "form-row" },
        field("E-Mail", text("email", { type: "email" })),
        field("Telefon", text("phone", { type: "tel" }))),
      field("Anschrift", text("address")),
      h("label", { class: "check" }, inputs.private, "Privatkunde (eigene Pipeline, unabhängig von Firmen)"),
      privateBlock,
      field("Haushalt", h("div", {}, inputs.household, houseList)),
      h("div", { class: "form-row" },
        field("Datenschutz-Grundlage", inputs.consent),
        field("Datenschutz am", text("consent_date", { type: "date" }))),
      field("Notizen", (inputs.notes = h("textarea", { rows: 3 }, c.notes || ""))));
    dupes = duplicateWatch("contact", inputs, ["first_name", "last_name", "email", "phone"], contact, close);
    form.querySelector(".dupes-slot").append(dupes.box, dupes.confirmRow);
    return form;
  });
}

// Verbindung Person – Firma anlegen oder ändern. Von der Firma aus wird die Person gewählt, sonst die Firma.
async function linkDialog({ contactId = null, companyId = null, link = null }, onSaved) {
  const [companies, people] = await Promise.all([
    contactId && !link ? api("/api/companies") : Promise.resolve([]),
    companyId && !link ? api("/api/contacts") : Promise.resolve([]),
  ]);
  openDialog(link ? "Verbindung ändern" : contactId ? "Mit Firma verbinden" : "Vorhandene Person verbinden", (close) => {
    const kind = selectEl(meta.linkKinds, link ? link.kind : "Ansprechpartner/in");
    const role = h("input", { value: link ? link.role : "", placeholder: "zum Beispiel Geschäftsführer" });
    const primary = h("input", { type: "checkbox", checked: Boolean(link && link.is_primary) });
    const company = contactId && !link ? selectEl([["", "Bitte wählen"], ...companies.map((o) => [o.id, o.name])], "") : null;
    const picker = companyId && !link ? personPicker(people) : null;
    return dialogForm(close, async () => {
      const body = { kind: kind.value, role: role.value, is_primary: primary.checked };
      if (link) await api(`/api/links/${link.link_id}`, "PUT", body);
      else if (contactId) await api(`/api/contacts/${contactId}/companies`, "POST", { ...body, company_id: company.value });
      else {
        const person = picker.chosen();
        if (!person) throw new Error("Bitte eine Person aus der Liste wählen.");
        await api(`/api/contacts/${person}/companies`, "POST", { ...body, company_id: companyId });
      }
      close();
      onSaved();
    },
      company ? field("Firma", company) : null,
      picker ? field("Person", picker.field) : null,
      h("div", { class: "form-row" }, field("Rolle", kind), field("Funktion", role)),
      h("label", { class: "check" }, primary, "Hauptansprechperson dieser Firma"));
  });
}

async function relationDialog(c, onSaved) {
  const people = await api("/api/contacts");
  openDialog("Verbindung zu einer Person", (close) => {
    const kind = selectEl(Object.entries(meta.relations), "ehe");
    const picker = personPicker(people, c.id);
    const note = h("input", { placeholder: "optional" });
    return dialogForm(close, async () => {
      const other = picker.chosen();
      if (!other) throw new Error("Bitte eine Person aus der Liste wählen.");
      await api(`/api/contacts/${c.id}/relations`, "POST", { kind: kind.value, other_id: other, note: note.value });
      close();
      onSaved();
    },
      h("p", { class: "small muted" }, `${personName(c)} ist …`),
      field("Verbindung", kind),
      field("Person", picker.field),
      field("Notiz", note));
  });
}

function consentDialog(c, channel, state, onSaved) {
  const label = meta.channels[channel];
  openDialog(state === "erteilt" ? `Einwilligung erfassen: ${label}` : `Widerruf erfassen: ${label}`, (close) => {
    const source = selectEl(meta.consentSources.filter((x) => !x.startsWith("Webseite")), "Persönlich");
    const when = h("input", { type: "date", value: today(), max: today() });
    const proof = h("textarea", { rows: 2, placeholder: state === "erteilt"
      ? "Wie liegt die Einwilligung vor? Zum Beispiel: unterschriebenes Formular vom 12.11., abgelegt im Kundenordner"
      : "Optional, zum Beispiel: telefonisch widerrufen" });
    return dialogForm(close, async () => {
      await api(`/api/contacts/${c.id}/consents`, "POST", { channel, state, source: source.value, date: when.value, proof: proof.value });
      close();
      toast(state === "erteilt" ? "Einwilligung gespeichert" : "Widerruf gespeichert");
      onSaved();
    },
      h("p", { class: "small muted" }, state === "erteilt"
        ? "Eine Einwilligung muss freiwillig, für diesen Zweck und nachweisbar sein. Für Newsletter über die Webseite gilt das Double-Opt-in automatisch."
        : "Ein Widerruf gilt ab sofort. Der Eintrag bleibt als Nachweis erhalten."),
      h("div", { class: "form-row" }, field("Wie", source), field("Datum", when)),
      field("Nachweis", proof));
  });
}

async function companyDialog(company, onSaved, preset = {}) {
  const [companies, referrers] = await Promise.all([api("/api/companies"), api("/api/referrers")]);
  const c = company || { status: "Neu", ...preset };
  const inputs = {};
  const text = (name, attrs = {}) => (inputs[name] = h("input", { value: c[name] || "", autocomplete: "off", ...attrs }));

  // Eine Firma darf nicht unter sich selbst oder einer eigenen Tochter hängen.
  const blocked = new Set(company ? [company.id] : []);
  for (let grew = true; grew;) {
    grew = false;
    for (const o of companies) {
      if (o.parent_id && blocked.has(o.parent_id) && !blocked.has(o.id)) { blocked.add(o.id); grew = true; }
    }
  }
  const parents = companies.filter((o) => !blocked.has(o.id)).map((o) => [o.id, o.name]);

  openDialog(company ? "Firma bearbeiten" : "Neue Firma", (close) => {
    inputs.legal_form = selectEl([["", "Aus dem Namen erkennen"], ...meta.legalForms], c.legal_form || "");
    inputs.parent_id = selectEl([["", "Keine (oberste Ebene)"], ...parents], c.parent_id || "");
    inputs.status = selectEl(meta.statuses, c.status || "Neu");
    inputs.own_grade = selectEl([["", "Automatisch aus der Bilanz"], ...meta.grades], c.own_grade || "");
    const source = sourceFields(c, inputs, referrers);
    let dupes = null;
    const form = dialogForm(close, async () => {
      await dupes.guard();
      const data = readInputs(inputs);
      const saved = company
        ? await api(`/api/companies/${company.id}`, "PUT", data)
        : await api("/api/companies", "POST", data);
      close();
      onSaved(saved);
    },
      field("Firmenname", text("name", { placeholder: "zum Beispiel Muster GmbH" })),
      h("div", { class: "dupes-slot" }),
      h("div", { class: "form-row" },
        field("Rechtsform", inputs.legal_form),
        field("Firmenbuchnummer", text("register_no", { placeholder: "FN 123456a" }))),
      h("div", { class: "form-row" }, field("Branche", text("industry")), field("Webseite", text("website"))),
      h("div", { class: "form-row" },
        field("Telefon", text("phone", { type: "tel" })),
        field("Telefon 2", text("phone2", { type: "tel" }))),
      field("E-Mail", text("email", { type: "email" })),
      field("Anschrift", text("address")),
      field("Muttergesellschaft", inputs.parent_id),
      h("div", { class: "form-row" }, field("Status", inputs.status), field("Eigene Einstufung", inputs.own_grade)),
      source.source,
      source.referrer,
      field("Notizen", (inputs.notes = h("textarea", { rows: 3 }, c.notes || ""))));
    dupes = duplicateWatch("company", inputs, ["name", "register_no", "email", "phone", "phone2"], company, close);
    form.querySelector(".dupes-slot").append(dupes.box, dupes.confirmRow);
    return form;
  });
}

function referrerDialog(referrer, onSaved) {
  const r = referrer || {};
  const inputs = {};
  const text = (name, attrs = {}) => (inputs[name] = h("input", { value: r[name] || "", autocomplete: "off", ...attrs }));
  openDialog(referrer ? "Empfehler bearbeiten" : "Neuer Empfehler", (close) => {
    inputs.commission_agreed = h("input", { type: "checkbox", checked: Boolean(r.commission_agreed) });
    return dialogForm(close, async () => {
      const data = readInputs(inputs);
      const saved = referrer
        ? await api(`/api/referrers/${referrer.id}`, "PUT", data)
        : await api("/api/referrers", "POST", data);
      close();
      onSaved(saved);
    },
      field("Name", text("name")),
      h("div", { class: "form-row" },
        field("E-Mail", text("email", { type: "email" })),
        field("Telefon", text("phone", { type: "tel" }))),
      h("label", { class: "check" }, inputs.commission_agreed, "Provision vereinbart"),
      h("div", { class: "form-row" },
        field("Vereinbarung", text("commission_terms", { placeholder: "zum Beispiel Prozentsatz, Bezugsgröße" })),
        field("Vereinbart am", text("agreement_date", { type: "date" }))),
      field("Notizen", (inputs.notes = h("textarea", { rows: 3 }, r.notes || ""))));
  });
}

function financialDialog(companyId, financial, onSaved) {
  const f = financial || { year: new Date().getFullYear() - 1 };
  const inputs = {};
  const num = (name, label) => field(label, (inputs[name] = h("input", {
    type: "number", step: "1", value: f[name] ?? "", inputmode: "numeric",
  })));
  openDialog(financial ? `Bilanz ${f.year} bearbeiten` : "Bilanz erfassen", (close) => dialogForm(close, async () => {
    const data = readInputs(inputs);
    if (financial) await api(`/api/financials/${financial.id}`, "PUT", data);
    else await api(`/api/companies/${companyId}/financials`, "POST", data);
    close();
    onSaved();
  },
    h("p", { class: "small muted hint" }, "Beträge in ganzen Euro. Felder dürfen leer bleiben, wenn die Angabe fehlt."),
    h("div", { class: "form-row" },
      num("year", "Bilanzjahr"),
      field("Herkunft", (inputs.origin = h("input", { value: f.origin || "", placeholder: "zum Beispiel Firmenbuch" })))),
    h("div", { class: "form-row" }, num("total_assets", "Bilanzsumme"), num("equity", "Eigenkapital")),
    h("div", { class: "form-row" }, num("liquid", "Liquide Mittel (Kassa, Bank)"), num("securities", "Wertpapiere")),
    h("div", { class: "form-row" }, num("liabilities", "Verbindlichkeiten"), num("retained", "Bilanzgewinn"))));
}

/* Gemeinsame Bausteine: Aufgaben und Verlauf */

function taskRow(task, refresh, { owner = false, person = false } = {}) {
  const isOverdue = !task.done_at && task.due && task.due < today();
  return h("li", {},
    h("input", {
      type: "checkbox",
      checked: Boolean(task.done_at),
      "aria-label": `Erledigt: ${task.title}`,
      onchange: (e) => attempt(async () => {
        await api(`/api/tasks/${task.id}`, "PUT", { done: e.target.checked });
        refresh();
      }),
    }),
    h("div", { class: "grow" },
      h("div", { class: task.done_at ? "done" : "" }, task.title, task.area === "privat" || owner ? areaTag(task.area) : null),
      h("div", { class: "small muted" },
        owner ? [ownerLink(task), task.due ? " · " : ""] : null,
        person && task.person ? `${task.person}${task.due ? " · " : ""}` : null,
        task.due ? h("span", { class: isOverdue ? "overdue" : "" }, fmtDate(task.due)) : null)),
    owner ? null : h("button", {
      class: "iconbtn", type: "button", "aria-label": `Aufgabe löschen: ${task.title}`,
      onclick: () => attempt(async () => { await api(`/api/tasks/${task.id}`, "DELETE"); refresh(); }),
    }, "Löschen"));
}

function areaSelect(defaultArea) {
  return selectEl(Object.entries(meta.areas), defaultArea, { "aria-label": "Bereich" });
}

function taskSection(path, tasks, refresh, options = {}) {
  const title = h("input", { placeholder: "Nächster Schritt", "aria-label": "Aufgabe" });
  const due = h("input", { type: "date", "aria-label": "Fällig am" });
  const which = options.areaChoice ? areaSelect(options.areaChoice) : null;
  const form = h("form", {
    class: "addform taskadd",
    onsubmit: (e) => {
      e.preventDefault();
      attempt(async () => {
        await api(`${path}/tasks`, "POST", { title: title.value, due: due.value, area: which ? which.value : "" });
        refresh();
      });
    },
  }, title, due, which, h("button", { class: "btn", type: "submit" }, "Anlegen"));
  return section("Aufgaben", form,
    tasks.length
      ? h("ul", { class: "rows" }, tasks.map((t) => taskRow(t, refresh, options)))
      : h("p", { class: "empty" }, "Keine Aufgaben."));
}

function activitySection(path, activities, refresh, options = {}) {
  const which = options.areaChoice ? areaSelect(options.areaChoice) : null;
  const kind = selectEl(meta.kinds, "Telefonat", { "aria-label": "Art des Eintrags" });
  const when = h("input", { type: "date", value: today(), "aria-label": "Datum des Eintrags" });
  const entry = h("textarea", { rows: 2, placeholder: "Was wurde besprochen?", "aria-label": "Text des Eintrags" });
  const form = h("form", {
    class: "addform",
    onsubmit: (e) => {
      e.preventDefault();
      attempt(async () => {
        await api(`${path}/activities`, "POST", { kind: kind.value, date: when.value, text: entry.value, area: which ? which.value : "" });
        refresh();
      });
    },
  },
    h("div", { class: "inline" }, kind, when, which),
    entry,
    h("div", { class: "form-end" }, h("button", { class: "btn", type: "submit" }, "Eintrag speichern")));
  return section("Verlauf", form,
    activities.length
      ? h("ul", { class: "rows" }, activities.map((a) => h("li", {},
          h("div", { class: "grow" },
            h("div", { class: "small muted" },
              [a.kind === "System" ? "Änderung" : a.kind, fmtDate(a.date), a.person].filter(Boolean).join(", "),
              options.areaChoice ? areaTag(a.area) : null),
            h("p", { class: "prewrap" }, a.text)),
          a.kind === "System" ? null : h("button", {
            class: "iconbtn", type: "button", "aria-label": "Eintrag löschen",
            onclick: () => attempt(async () => { await api(`/api/activities/${a.id}`, "DELETE"); refresh(); }),
          }, "Löschen"))))
      : h("p", { class: "empty" }, "Noch keine Einträge."));
}

/* Übersicht */

async function renderOverview(token) {
  const o = await api(`/api/overview${areaParam()}`);
  if (token !== renderToken) return;
  const refresh = () => route();
  const total = Object.values(o.counts).reduce((a, b) => a + b, 0);
  const dueNow = [...o.overdue, ...o.today];
  const taskOptions = { owner: true };

  setView(
    pageHead(new Intl.DateTimeFormat("de-AT", { weekday: "long", day: "numeric", month: "long" }).format(new Date()), "Übersicht"),
    areaNote(),
    total === 0 ? h("div", { class: "note" }, "Noch keine Einträge vorhanden. Lege oben rechts die erste Firma oder den ersten Kontakt an.") : null,
    o.consentOpen ? h("div", { class: "note" },
      o.consentOpen === 1
        ? "Bei 1 Person ist die Datenschutz-Grundlage offen oder widerrufen."
        : `Bei ${o.consentOpen} Personen ist die Datenschutz-Grundlage offen oder widerrufen.`) : null,
    h("div", { class: "stats" }, meta.pipeline.map((s) =>
      h("a", { class: "stat", href: "#/pipeline" }, h("b", {}, o.counts[s] || 0), h("span", {}, s)))),
    h("div", { class: "grid2" },
      h("div", { class: "stack" },
        section("Heute zu erledigen",
          dueNow.length
            ? h("ul", { class: "rows" }, dueNow.map((t) => taskRow(t, refresh, taskOptions)))
            : h("p", { class: "empty" }, "Nichts fällig.")),
        section("Demnächst",
          o.upcoming.length
            ? h("ul", { class: "rows" }, o.upcoming.map((t) => taskRow(t, refresh, taskOptions)))
            : h("p", { class: "empty" }, "Keine weiteren Termine."))),
      h("div", { class: "stack" },
        section("Lange kein Kontakt",
          h("p", { class: "small muted" }, `Kunden ohne Eintrag seit mehr als ${meta.quietDays} Tagen`),
          o.quiet.length
            ? h("ul", { class: "rows" }, o.quiet.map((c) => h("li", {},
                h("div", { class: "grow" },
                  h("a", { class: "name", href: c.kind === "company" ? `#/firma/${c.id}` : `#/kontakt/${c.id}` }, c.name),
                  h("div", { class: "small muted" },
                    c.last_contact ? `Zuletzt ${fmtDate(c.last_contact)}` : "Noch kein Eintrag")))))
            : h("p", { class: "empty" }, "Alle Kunden sind aktuell.")),
        section("Zuletzt",
          o.recent.length
            ? h("ul", { class: "rows" }, o.recent.map((a) => h("li", {},
                h("div", { class: "grow" }, ownerLink(a),
                  h("div", { class: "small muted" }, `${a.kind}, ${fmtDate(a.date)}`),
                  h("div", {}, a.text)))))
            : h("p", { class: "empty" }, "Noch keine Einträge.")))),
    h("p", { class: "small muted" }, h("a", { href: "#/einstellungen" }, "Einstellungen: Daten übertragen, Schnittstelle für die Webseite")));
}

/* Daten zwischen Rechnern übertragen: eine Datei mit allen Daten sichern und auf dem anderen Rechner einlesen. */

function inApp() {
  return Boolean(window.pywebview && window.pywebview.api && window.pywebview.api.save_download);
}

// Im App-Fenster gibt es keine Downloads: Dateien über den Speichern-Dialog des Betriebssystems ablegen.
async function download(path, filename) {
  if (!inApp()) {
    const link = h("a", { href: path, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    return;
  }
  const result = await window.pywebview.api.save_download(path, filename);
  if (result && result.error) throw new Error(result.error);
  if (result && result.saved) toast(`Gespeichert: ${result.saved}`);
}

function dataSection() {
  const stamp = () => new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const picker = h("input", { type: "file", accept: ".crmdaten,.sqlite", hidden: true });
  picker.addEventListener("change", () => attempt(async () => {
    const file = picker.files[0];
    picker.value = "";
    if (!file) return;
    const yes = await confirmDialog("Daten einlesen",
      `Alle Daten in diesem CRM werden durch den Stand aus „${file.name}“ ersetzt.\n\nDer bisherige Stand wird vorher automatisch im Ordner „Sicherungen“ abgelegt.`,
      "Daten ersetzen");
    if (!yes) return;
    const res = await fetch("/api/restore", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Die Datei ließ sich nicht einlesen.");
    toast(`Eingelesen: ${data.companies} Firmen, ${data.contacts} Personen`);
    route();
  }));
  return section("Daten übertragen",
    h("p", { class: "small muted" }, "Jeder Rechner hat seine eigenen Daten. Um auf einen anderen Rechner umzuziehen, hier die Daten sichern, die Datei hinüberkopieren (USB-Stick, verschlüsselte Ablage) und dort einlesen. Die Datei enthält alle Kundendaten, bitte sorgsam aufbewahren und nicht per E-Mail verschicken."),
    h("div", { class: "form-end spaced" },
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => attempt(() => download("/api/backup", `Meerkoetter-CRM-Daten-${stamp()}.crmdaten`)) }, "Daten sichern"),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => picker.click() }, "Daten einlesen"),
      picker),
    h("p", { class: "small muted" }, `Version ${meta.version || ""}`));
}

// Export-Links (CSV) auch im App-Fenster speicherbar machen.
document.addEventListener("click", (e) => {
  const link = e.target.closest && e.target.closest('a[href^="/api/export"]');
  if (!link || !inApp()) return;
  e.preventDefault();
  const path = link.getAttribute("href");
  const name = `meerkoetter-${path.includes("firmen") ? "firmen" : "kontakte"}-${new Date().toISOString().slice(0, 10)}.csv`;
  attempt(() => download(path, name));
});

/* Firmen als Baum */

async function renderTree(token) {
  const data = await api("/api/tree");
  if (token !== renderToken) return;

  const search = h("input", { type: "search", placeholder: "Firma, Person, Ort, Branche, Telefon, E-Mail", "aria-label": "Firmenbaum durchsuchen" });
  const statusFilter = selectEl([["", "Alle Status"], ...meta.statuses], "", { "aria-label": "Nach Status filtern" });
  const gradeFilter = selectEl([["", "Alle Einstufungen"], ...meta.grades, ["none", "Ohne Einstufung"]], "", { "aria-label": "Nach Einstufung filtern" });
  const formFilter = selectEl([["", "Alle Rechtsformen"], ...meta.legalForms], "", { "aria-label": "Nach Rechtsform filtern" });
  const balanceFilter = selectEl([["", "Mit und ohne Bilanz"], ["missing", "Ohne Bilanz"], ["present", "Mit Bilanz"]], "", { "aria-label": "Nach Bilanz filtern" });
  const count = h("p", { class: "small muted tree-count" });
  let picking = false;
  const picked = new Set();
  const pickBar = h("div", { class: "pickbar", hidden: true });
  const startPicking = h("button", { class: "btn btn-ghost", type: "button", onclick: () => { picking = true; draw(); } }, "Arbeitsliste erstellen");
  const nameOf = new Map(data.companies.map((c) => [c.id, c.name]));
  function togglePick(id, box) {
    if (!picked.has(id) && picked.size >= WORKLIST_MAX) toast(`Höchstens ${WORKLIST_MAX} Firmen pro Arbeitsliste`, true);
    else if (picked.has(id)) picked.delete(id); else picked.add(id);
    setTimeout(() => { box.checked = picked.has(id); }, 0);
    drawPickBar();
  }
  function visibleIds() {
    return [...result.querySelectorAll("input.pick")].map((b) => Number(b.dataset.id));
  }
  function drawPickBar() {
    pickBar.hidden = !picking;
    startPicking.hidden = picking;
    if (!picking) return;
    pickBar.replaceChildren(
      h("span", {}, h("b", {}, `${picked.size} ausgewählt`), h("span", { class: "small muted" }, ` (höchstens ${WORKLIST_MAX})`)),
      h("div", { class: "worklist-actions" },
        h("button", { class: "btn btn-ghost", type: "button", onclick: () => {
          for (const id of visibleIds()) { if (picked.size >= WORKLIST_MAX) break; picked.add(id); }
          draw();
        } }, `Angezeigte auswählen`),
        h("button", { class: "btn btn-ghost", type: "button", disabled: !picked.size, onclick: () => { picked.clear(); draw(); } }, "Auswahl leeren"),
        h("button", { class: "btn btn-ghost", type: "button", onclick: () => { picking = false; picked.clear(); draw(); } }, "Abbrechen"),
        h("button", { class: "btn", type: "button", disabled: !picked.size, onclick: () => {
          const order = visibleIds().filter((id) => picked.has(id));
          const ids = [...order, ...[...picked].filter((id) => !order.includes(id))];
          saveWorklist({ ids, names: Object.fromEntries(ids.map((id) => [id, nameOf.get(id)])), pos: 0, done: [], skipped: [] });
          worklistGo();
        } }, "Arbeitsliste starten")));
  }
  const result = h("div", {});

  const childrenOf = new Map();
  for (const c of data.companies) {
    const key = c.parent_id || 0;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(c);
  }

  // Sortierung über die Spaltenköpfe, je Ebene des Baums. Die Wahl merkt sich der Browser.
  const SORT_KEY = "crm-firmen-sortierung";
  let sort = { key: "name", dir: 1 };
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY) || "null");
    if (saved && ["name", "ort", "status", "grade"].includes(saved.key) && [1, -1].includes(saved.dir)) sort = saved;
  } catch { /* ohne gespeicherte Wahl */ }
  const collator = new Intl.Collator("de", { sensitivity: "base", numeric: true });
  const placeName = (c) => placeOf(c.address).replace(/^\d+\s+/, "");
  const plzOf = (c) => parseInt(placeOf(c.address), 10) || 99999;  // ohne PLZ ans Ende
  const rank = {
    status: (c) => meta.statuses.indexOf(c.status),
    grade: (c) => (c.rating.grade ? meta.grades.indexOf(c.rating.grade) : meta.grades.length),
  };
  const byName = (a, b) => collator.compare(a.name.replace(/^["'„“‚‘\s]+/, ""), b.name.replace(/^["'„“‚‘\s]+/, ""));
  function compare(a, b) {
    let result = 0;
    if (sort.key === "ort") result = plzOf(a) - plzOf(b) || collator.compare(placeName(a), placeName(b));
    else if (sort.key in rank) result = rank[sort.key](a) - rank[sort.key](b);
    else result = byName(a, b);
    if (sort.key === "grade" && !a.rating.grade !== !b.rating.grade) return a.rating.grade ? -1 : 1;  // ohne Einstufung immer zuletzt
    return result * sort.dir || byName(a, b);
  }
  const sorted = (list) => (list || []).slice().sort(compare);
  function sortHeader(key, label, cls) {
    const active = sort.key === key;
    return h("span", { class: cls, role: "columnheader", "aria-sort": active ? (sort.dir === 1 ? "ascending" : "descending") : "none" },
      h("button", {
        class: `th-sort${active ? " active" : ""}`, type: "button",
        title: `Nach ${label} sortieren`,
        onclick: () => {
          sort = { key, dir: active ? -sort.dir : 1 };
          try { localStorage.setItem(SORT_KEY, JSON.stringify(sort)); } catch { /* nur für diese Sitzung */ }
          draw();
        },
      }, label, h("span", { class: "th-arrow", "aria-hidden": "true" }, active ? (sort.dir === 1 ? "▲" : "▼") : "")));
  }

  function personMatches(p, q) {
    return !q || [personName(p), p.kind, p.role, p.email, p.phone].some((v) => (v || "").toLowerCase().includes(q));
  }
  function companyMatches(c, q) {
    const texts = [c.name, c.industry, c.register_no, c.phone, c.phone2, c.email, c.address].some((v) => (v || "").toLowerCase().includes(q));
    if (q && !texts && !c.people.some((p) => personMatches(p, q))) return false;
    if (statusFilter.value && c.status !== statusFilter.value) return false;
    if (formFilter.value && c.legal_form !== formFilter.value) return false;
    if (balanceFilter.value === "missing" && c.rating.year) return false;
    if (balanceFilter.value === "present" && !c.rating.year) return false;
    if (gradeFilter.value === "none" && c.rating.grade) return false;
    if (gradeFilter.value && gradeFilter.value !== "none" && c.rating.grade !== gradeFilter.value) return false;
    return true;
  }

  function personNode(p) {
    return h("li", { class: "tree-person" },
      personLink(p),
      p.is_primary ? h("span", { class: "tag" }, "Hauptansprechperson") : null,
      h("span", { class: "small muted" }, [p.role || p.kind, p.private ? "auch Privatkunde" : ""].filter(Boolean).join(" · ")));
  }

  // Liefert den Knoten einer Firma oder null, wenn weder sie noch eine Tochter zum Filter passt.
  function companyNode(c, q) {
    const kids = sorted(childrenOf.get(c.id)).map((k) => companyNode(k, q)).filter(Boolean);
    const self = companyMatches(c, q);
    if (!self && !kids.length) return null;
    const textHit = !q || [c.name, c.industry, c.register_no, c.phone, c.phone2, c.email, c.address].some((v) => (v || "").toLowerCase().includes(q));
    const people = textHit ? c.people : c.people.filter((p) => personMatches(p, q));
    const branch = people.length || kids.length
      ? h("ul", { class: "tree" }, people.map(personNode), kids)
      : null;
    const box = picking ? h("input", {
      type: "checkbox", class: "pick", "data-id": c.id, checked: picked.has(c.id), "aria-label": `${c.name} für die Arbeitsliste auswählen`,
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); togglePick(c.id, e.target); },
    }) : null;
    const head = [
      box ? h("span", { class: "tc-pick" }, box) : null,
      h("span", { class: "tc-name" }, companyLink(c.id, c.name),
        c.rating.investable !== null ? h("span", { class: "small muted hide-sm" }, ` Anlagefähig ${money(c.rating.investable)}`) : null),
      h("span", { class: "tc-ort" }, placeOf(c.address)),
      h("span", { class: "tc-status" }, badge(c.status)),
      h("span", { class: "tc-grade" }, gradeBadge(c.rating.grade)),
    ];
    return h("li", { class: "tree-company" }, branch
      ? h("details", { open: true }, h("summary", {}, head), branch)
      : h("div", { class: "tree-leaf" }, head));
  }

  function draw() {
    drawPickBar();
    const q = search.value.trim().toLowerCase();
    const roots = sorted(childrenOf.get(0)).map((c) => companyNode(c, q)).filter(Boolean);
    const hits = data.companies.filter((c) => companyMatches(c, q)).length;
    count.textContent = hits === data.companies.length ? `${hits} Firmen` : `${hits} von ${data.companies.length} Firmen`;
    if (!roots.length) {
      result.replaceChildren(h("p", { class: "empty" }, data.companies.length
        ? "Nichts gefunden." : "Noch keine Firmen. Lege oben rechts die erste an."));
      return;
    }
    result.replaceChildren(...[
      roots.length ? h("section", { class: "card" },
        h("div", { class: "tree-head", role: "row" },
          picking ? h("span", { class: "tc-pick" }) : null,
          sortHeader("name", "Firma", "tc-name"), sortHeader("ort", "Ort", "tc-ort"),
          sortHeader("status", "Status", "tc-status"), sortHeader("grade", "Einst.", "tc-grade")),
        h("ul", { class: "tree tree-root" }, roots)) : null,
    ].filter(Boolean));
  }

  search.addEventListener("input", draw);
  [statusFilter, gradeFilter, formFilter, balanceFilter].forEach((el) => el.addEventListener("change", draw));
  draw();

  setView(
    pageHead("Firmen", "Firmen und Ansprechpartner",
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => firmenbuchDialog(null, () => route()) }, "Firma aus Bilanz anlegen"),
      startPicking,
      h("a", { class: "btn btn-ghost", href: "/api/export-firmen.csv" }, "Als CSV exportieren")),
    worklistCurrent() !== null ? h("div", { class: "worklist" },
      h("div", { class: "worklist-text" }, h("b", {}, `Arbeitsliste läuft: Firma ${worklist.pos + 1} von ${worklist.ids.length}`),
        h("span", { class: "small muted" }, ` · ${worklist.done.length} erledigt`)),
      h("div", { class: "worklist-actions" },
        h("button", { class: "btn", type: "button", onclick: () => worklistGo() }, "Fortsetzen"),
        h("button", { class: "btn btn-ghost", type: "button", onclick: () => { worklistEnd(); route(); } }, "Beenden"))) : null,
    h("div", { class: "tools" }, search, statusFilter, gradeFilter, formFilter, balanceFilter),
    count,
    pickBar,
    h("div", { class: "stack" }, result));
}

/* Arbeitsliste: Firmen der Reihe nach abarbeiten, z. B. zum Einfügen von Bilanzen */

const WORKLIST_KEY = "crm-arbeitsliste";
const WORKLIST_MAX = 20;
let worklist = null;
try { worklist = JSON.parse(localStorage.getItem(WORKLIST_KEY) || "null"); } catch { worklist = null; }
if (!worklist || !Array.isArray(worklist.ids)) worklist = null;

function saveWorklist(w) {
  worklist = w;
  try {
    if (w) localStorage.setItem(WORKLIST_KEY, JSON.stringify(w)); else localStorage.removeItem(WORKLIST_KEY);
  } catch { /* gilt dann nur bis zum Neuladen */ }
}

function worklistCurrent() {
  return worklist && worklist.pos < worklist.ids.length ? worklist.ids[worklist.pos] : null;
}

function worklistGo() {
  const w = worklist;
  if (!w) return;
  if (w.pos >= w.ids.length) {
    saveWorklist(null);
    toast(`Arbeitsliste fertig: ${w.done.length} erledigt, ${w.skipped.length} übersprungen`);
    location.hash = "#/firmen";
    return;
  }
  w.openDialog = true;
  saveWorklist(w);
  const target = `#/firma/${w.ids[w.pos]}`;
  if (location.hash === target) route(); else location.hash = target;
}

function worklistAdvance(kind) {
  const id = worklistCurrent();
  if (id === null) return;
  worklist[kind].push(id);
  worklist.pos += 1;
  worklistGo();
}

function worklistEnd() {
  const w = worklist;
  saveWorklist(null);
  if (w) toast(`Arbeitsliste beendet: ${w.done.length} erledigt`);
}

function worklistBar(c) {
  const w = worklist;
  const next = w.ids[w.pos + 1];
  return h("div", { class: "worklist" },
    h("div", { class: "worklist-text" },
      h("b", {}, `Arbeitsliste: Firma ${w.pos + 1} von ${w.ids.length}`),
      h("span", { class: "small muted" }, next ? ` · danach ${w.names[next] || "nächste Firma"}` : " · letzte Firma")),
    h("div", { class: "worklist-actions" },
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => firmenbuchDialog(c, () => afterBalanceImport(c)) }, "Bilanz einfügen"),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => worklistAdvance("skipped") }, "Überspringen"),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => { worklistEnd(); route(); } }, "Beenden")));
}

// Nach dem Einfügen einer Bilanz: in der Arbeitsliste weiter zur nächsten Firma, sonst Seite neu laden.
function afterBalanceImport(c, refresh = () => route()) {
  if (worklistCurrent() === c.id) worklistAdvance("done"); else refresh();
}

/* Firma im Detail */

// Link zu openfirmenbuch.at: mit Firmenbuchnummer direkt zur Firma, sonst Suche nach dem Namen ohne Rechtsform.
function firmenbuchUrl(c) {
  const fn = (c.register_no || "").toLowerCase().replace(/^fn/, "").replace(/\s+/g, "");
  if (/^\d{1,6}[a-z]$/.test(fn)) return `https://openfirmenbuch.at/company/?fnr=${encodeURIComponent(fn)}`;
  let name = (c.name || "")
    .replace(/\bin\s+liqu(idation)?\.?/gi, "")
    .replace(/\b(gmbh\s*(&|und)\s*co\.?\s*kg|ges(ellschaft)?\.?\s*m\.?\s*b\.?\s*h\.?|g\.?\s*m\.?\s*b\.?\s*h\.?|gesmbh|mbh)(?=\W|$)/gi, " ")
    .replace(/(\S)(ges\.?\s*m\.?\s*b\.?\s*h\.?|gmbh)(?=\s|$)/gi, "$1")
    .replace(/["'„“”‚‘’]/g, " ")
    .replace(/\s+/g, " ").trim().replace(/[\s,.&+-]+$/, "");
  if (name.length > 50) name = name.slice(0, 50).replace(/\s+\S*$/, "");
  return `https://openfirmenbuch.at/results/?query=${encodeURIComponent(name || c.name.slice(0, 50))}&page=1`;
}

/* Bilanz aus dem kopierten Text einer openfirmenbuch.at-Seite */

const FB_FIELDS = [
  ["total_assets", "Bilanzsumme", ["Bilanzsumme"]],
  ["equity", "Eigenkapital", ["Eigenkapital"]],
  ["liquid", "Liquide Mittel", ["Kassenbestand, Schecks, Guthaben bei Kreditinstituten"]],
  ["securities", "Wertpapiere", ["Wertpapiere und Anteile"]],
  ["liabilities", "Verbindlichkeiten", ["Verbindlichkeiten"]],
  ["retained", "Bilanzgewinn", ["Bilanzgewinn", "Bilanzverlust"]],
];

function fbAmount(line) {
  const match = /^(-?)\s*€\s*(-?)\s*([\d.]+)(?:,\d+)?(?:\s*\(.*\))?$/.exec(line);
  if (!match) return null;
  const value = Number(match[3].replace(/\./g, ""));
  return match[1] || match[2] ? -value : value;
}

function coreName(name) {
  return (name || "").toLowerCase()
    .replace(/\b(gmbh\s*(&|und)\s*co\.?\s*kg|ges(ellschaft)?\.?\s*m\.?\s*b\.?\s*h\.?|g\.?\s*m\.?\s*b\.?\s*h\.?|gesmbh|mbh|gesellschaft mit beschränkter haftung)(?=\W|$)/g, " ")
    .replace(/(\S)(ges\.?\s*m\.?\s*b\.?\s*h\.?|gmbh)(?=\s|$)/g, "$1")
    .replace(/[^a-z0-9äöüß]/g, "");
}

// Zerlegt den eingefügten Text in einzelne Seiten und liest je Seite Jahr, Nummer und Bilanzwerte.
// Personenangaben im Text werden nicht ausgewertet.
function parseFirmenbuch(text) {
  const pages = text.split(/(?=^\s*Zurück zur Suche\s*$)/m).filter((p) => /Bilanzsumme/.test(p));
  return pages.map((page) => {
    const lines = page.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const result = { values: {}, missing: [] };
    const fn = /Firmenbuchnummer:?\s*(\d{1,6})\s*([a-z])\b/i.exec(page);
    if (fn) result.fn = `FN ${fn[1]}${fn[2].toLowerCase()}`;
    const head = lines.indexOf("Firmendetails");
    if (head >= 0) result.name = lines[head + 1];
    const year = /aus dem Geschäftsjahr\s+(\d{4})/.exec(page);
    const tick = lines.indexOf("✓");
    result.year = year ? Number(year[1]) : (tick > 0 && /^\d{4}$/.test(lines[tick - 1]) ? Number(lines[tick - 1]) : null);
    const start = lines.indexOf("Finanzübersicht");
    const end = lines.indexOf("Datengrundlage");
    const block = lines.slice(start >= 0 ? start : 0, end > 0 ? end : lines.length);
    for (const [key, label, names] of FB_FIELDS) {
      for (const name of names) {
        const at = block.indexOf(name);
        if (at < 0) continue;
        const value = fbAmount(block[at + 1] || "");
        if (value === null) continue;
        result.values[key] = name === "Bilanzverlust" && value > 0 ? -value : value;
        break;
      }
      if (!(key in result.values)) result.missing.push(label);
    }
    return result;
  });
}

// Ordnet in einem Screenshot jeder Beschriftung ihren Betrag zu: erst in derselben Zeile rechts, sonst direkt darunter.
const SHOT_LABELS = {
  total_assets: ["Bilanzsumme"], equity: ["Eigenkapital"],
  liquid: ["Kassenbestand, Schecks, Guthaben bei Kreditinstituten"], securities: ["Wertpapiere und Anteile"],
  liabilities: ["Verbindlichkeiten"], retained: ["Bilanzgewinn", "Bilanzverlust"],
  fixed: ["Anlagevermögen"], current: ["Umlaufvermögen"], deferred: ["Rechnungsabgrenzungsposten"],
  provisions: ["Rückstellungen"], deferredIncome: ["Passive Rechnungsabgrenzungsposten"],
  carry: ["Verlustvortrag", "Gewinnvortrag"],
};

// Liest einen Betrag aus einer Bildzeile. Zeichen danach (Pfeile, Lesefehler) werden ignoriert,
// aber nur, wenn die Zahl davor vollständig ist: "205.11ął" wird verworfen statt falsch gelesen.
function shotAmount(text) {
  const t = text.trim().replace(/(?<=[€\s.\d])[Oo]+(?=[\d.\s(,]|$)/g, (m) => "0".repeat(m.length));
  const match = /^(-?)\s*€\s*(-?)\s*(\d{1,3}(?:\.\d{3})*)(?:,\d{1,2})?(?![\d.,])/.exec(t);
  if (!match) return null;
  const value = Number(match[3].replace(/\./g, ""));
  return match[1] || match[2] ? -value : value;
}

// Prüfbuchstabe der österreichischen Firmenbuchnummer: schützt vor Lesefehlern der Texterkennung.
function fnValid(number, letter) {
  const digits = number.padStart(6, "0").split("").map(Number);
  const sum = digits.reduce((n, d, i) => n + d * [6, 4, 14, 15, 10, 1][i], 0);
  return "abdfghikmpstvwxyz"[sum % 17] === letter.toLowerCase();
}

// Firmenname und Firmenbuchnummer, falls der Screenshot den Kopf der Firmenseite zeigt.
function screenshotHead(lines) {
  const head = {};
  for (const l of lines) {
    const m = /\b(?:FN|Firmenbuchnummer:?)\s*(\d{1,6})\s?([a-zA-Z])\b/.exec(l.text);
    if (m && fnValid(m[1], m[2])) { head.fn = `FN ${m[1]}${m[2].toLowerCase()}`; break; }
  }
  const form = /(GmbH|Ges\.?\s?m\.?\s?b\.?\s?H\.?|Gesellschaft m\.?\s?b\.?\s?H\.?|GmbH & Co\.? KG|\bAG|\bKG|\bOG|e\.\s?U\.|FlexCo)\.?$/;
  const name = [...lines].sort((a, b) => a.y - b.y)
    .find((l) => form.test(l.text.trim()) && !/€|\d{3}\.\d{3}|Rechtsform|beschränkter Haftung/.test(l.text) && l.text.trim().length <= 120);
  if (name) head.name = name.text.trim();
  return head;
}

function parseScreenshot(lines) {
  // Steht der Betrag in derselben erkannten Zeile wie die Beschriftung, die Zeile wieder trennen.
  const split = lines.flatMap((l) => {
    const m = /^(.*[A-Za-zÄÖÜäöüß].*?)\s+(-?\s*€.*)$/.exec(l.text.trim());
    return m ? [{ ...l, text: m[1] }, { ...l, x: l.x + 1, text: m[2] }] : [l];
  });
  const items = split.map((l) => ({ ...l, text: l.text.trim(), amount: shotAmount(l.text) }));
  const amounts = items.filter((i) => i.amount !== null);
  const labels = items.filter((i) => i.amount === null);
  const ends = (text, name) => text === name || text.endsWith(" " + name);
  const result = { values: {}, extra: {}, missing: [], ...screenshotHead(lines) };
  for (const [key, names] of Object.entries(SHOT_LABELS)) {
    let label = null;
    for (const name of names) {
      label = labels.filter((l) => ends(l.text, name)
        && !(name === "Rechnungsabgrenzungsposten" && /Passive/.test(l.text))).sort((a, b) => a.y - b.y)[0];
      if (label) { label.name = name; break; }
    }
    if (!label) continue;
    // Abstände in Zeilenhöhen statt in Bildanteilen: so ist egal, wie groß der Ausschnitt ist.
    const lh = label.h || 20;
    const middle = (i) => i.y + (i.h || lh) / 2;
    const row = amounts.filter((a) => Math.abs(middle(a) - middle(label)) <= 0.6 * Math.max(lh, a.h || lh) && a.x > label.x)
      .sort((a, b) => a.x - b.x)[0];
    const below = amounts.filter((a) => a.y > label.y && a.y - label.y <= 4 * lh && Math.abs(a.x - label.x) <= 60)
      .sort((a, b) => a.y - b.y)[0];
    const hit = row || below;
    if (!hit) continue;
    let value = hit.amount;
    if (label.name === "Bilanzverlust" || label.name === "Verlustvortrag") value = -Math.abs(value);
    if (FB_FIELDS.some(([k]) => k === key)) result.values[key] = value; else result.extra[key] = value;
  }
  for (const [key, label] of FB_FIELDS) if (!(key in result.values)) result.missing.push(label);
  // Plausibilität: Aktiva und Passiva müssen die Bilanzsumme ergeben.
  const v = { ...result.values, ...result.extra };
  if (v.total_assets !== undefined && v.fixed !== undefined && v.current !== undefined) {
    const aktiva = v.fixed + v.current + (v.deferred || 0);
    const passiva = (v.equity ?? NaN) + (v.provisions || 0) + (v.liabilities ?? NaN) + (v.deferredIncome || 0);
    result.check = Math.abs(aktiva - v.total_assets) <= 2 && Math.abs(passiva - v.total_assets) <= 2;
  }
  return result;
}

// Ordnet Screenshots ohne Jahr über den Vortrag: Der Bilanzgewinn eines Jahres ist der Vortrag des Folgejahres.
function suggestYears(shots, newest) {
  const open = shots.filter((s) => !s.yearSet);
  if (!open.length) return;
  const previousOf = new Map();
  for (const s of open) {
    const prev = open.find((o) => o !== s && s.extra.carry !== undefined && o.values.retained === s.extra.carry);
    if (prev) previousOf.set(s, prev);
  }
  const isPrevious = new Set(previousOf.values());
  const chain = [];
  let cursor = open.find((s) => !isPrevious.has(s) && previousOf.has(s)) || null;
  while (cursor && !chain.includes(cursor)) { chain.push(cursor); cursor = previousOf.get(cursor); }
  const ordered = chain.length === open.length ? chain : open;  // ohne lückenlose Kette: Reihenfolge des Einfügens
  ordered.forEach((s, i) => { s.year = newest - i; });
  return chain.length === open.length && open.length > 1;
}

// Liest einen eingereichten Jahresabschluss (PDF mit Text) aus: Stichtag, Firmenbuchnummer,
// Bilanzposten des Jahres und die Vorjahresspalte in TEUR. Personenangaben werden nicht ausgewertet.
function parseAbschluss(text, source) {
  const fn = /\bFN\s*(\d{1,6})\s*([a-z])\b/i.exec(text);
  const day = /Bilanzstichtag:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text);
  if (!day) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const nameAt = lines.indexOf("FIRMA");
  let start = lines.findIndex((l) => /Auszug aus der Bilanz|^Bilanz\b/i.test(l));
  if (start < 0) start = 0;
  let end = lines.findIndex((l, i) => i > start && /Anhang|Gewinn- und Verlustrechnung/i.test(l) && !/Anlage 1/.test(l));
  if (end < 0) end = lines.length;
  const euro = (v) => Math.round(Number(v.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")));
  const rows = [];
  for (const line of lines.slice(start, end)) {
    const m = /^(.*?[A-Za-zÄÖÜäöüß)].*?)\s+(-\s?[\d.]+,\d{2}|[\d.]+,\d{2})(?:\s+(-\s?[\d.]+(?:,\d+)?|[\d.]+(?:,\d+)?))?$/.exec(line);
    if (!m) continue;
    const label = m[1].replace(/^([A-Z]|[IVX]+|\d+)\.\s+/, "").trim();
    rows.push({ label, now: euro(m[2]), before: m[3] !== undefined ? euro(m[3]) * 1000 : undefined });
  }
  const find = (test, nth = 0) => rows.filter((r) => test(r.label))[nth];
  const picks = {
    total_assets: find((l) => /^(Summe\s+)?Aktiva$/i.test(l)),
    equity: find((l) => /^Eigenkapital/.test(l)),
    liquid: find((l) => /^Kassenbestand/.test(l)),
    securities: find((l) => l === "Wertpapiere und Anteile"),
    liabilities: find((l) => l === "Verbindlichkeiten"),
    retained: find((l) => /^Bilanzgewinn|^Bilanzverlust/.test(l)),
  };
  const extra = {
    passiva: find((l) => /^(Summe\s+)?Passiva$/i.test(l)), fixed: find((l) => l === "Anlagevermögen"),
    current: find((l) => l === "Umlaufvermögen"), deferred: find((l) => l === "Rechnungsabgrenzungsposten"),
    provisions: find((l) => /^Rückstellungen/.test(l)), deferredIncome: find((l) => l === "Rechnungsabgrenzungsposten", 1),
  };
  if (!picks.total_assets) return null;
  const stichtag = `${day[1].padStart(2, "0")}.${day[2].padStart(2, "0")}.${day[3]}`;
  const build = (which) => {
    const values = {};
    const missing = [];
    for (const [key, label] of FB_FIELDS) {
      const value = picks[key]?.[which];
      if (value === undefined) missing.push(label); else values[key] = value;
    }
    return { values, missing };
  };
  const now = build("now");
  const sum = (...keys) => keys.reduce((n, k) => n + (extra[k]?.now ?? picks[k]?.now ?? 0), 0);
  const check = extra.fixed && extra.current
    ? Math.abs(sum("fixed", "current", "deferred") - picks.total_assets.now) <= 2
      && Math.abs(sum("equity", "provisions", "liabilities", "deferredIncome") - picks.total_assets.now) <= 2
    : undefined;
  const base = { fn: fn ? `FN ${fn[1]}${fn[2].toLowerCase()}` : undefined, name: nameAt >= 0 ? lines[nameAt + 1] : undefined, pdf: source };
  const result = [{ ...base, ...now, year: Number(day[3]), source, check, origin: `Jahresabschluss (PDF), Stichtag ${stichtag}` }];
  const before = build("before");
  if (picks.total_assets.before !== undefined) {
    result.push({ ...base, ...before, year: Number(day[3]) - 1, source: `${source}, Vorjahr`, previous: true,
      origin: `Jahresabschluss (PDF) zum Stichtag ${stichtag}, Vorjahreswerte gerundet auf TEUR` });
  }
  return result;
}

// c = null: Firma gibt es noch nicht, sie wird aus den Unterlagen angelegt.
function firmenbuchDialog(c, refresh) {
  let creating = !c;
  if (creating) c = { name: "", register_no: "", financials: [] };
  openDialog(creating ? "Neue Firma aus Bilanz anlegen" : "Bilanz aus Firmenbuch einfügen", (close) => {
    const area = h("textarea", { rows: 4, placeholder: "Seitentext oder Screenshot hier einfügen (Cmd+V), Bild oder PDF hierher ziehen", "aria-label": "Text oder Screenshot von openfirmenbuch.at" });
    const picker = h("input", { type: "file", accept: "image/*,application/pdf", multiple: true, hidden: true });
    const preview = h("div", {});
    const status = h("p", { class: "small muted hint", hidden: true });
    const error = h("p", { class: "error", hidden: true });
    const save = h("button", { class: "btn", type: "button", disabled: true }, "Übernehmen");
    const shots = [];
    const pdfs = [];  // je PDF eine Liste: Jahr des Stichtags und Vorjahr
    let found = [];
    let chained = false;
    let confirmed = "";  // bestätigte Zuordnung trotz anderem Firmennamen
    let existing = new Set(c.financials.map((f) => f.year));

    // Nur beim Anlegen: Name und Nummer der neuen Firma, vorbelegt aus den Unterlagen, und die Dublettenprüfung.
    const nameInput = h("input", { autocomplete: "off", placeholder: "wird aus den Unterlagen übernommen" });
    const fnInput = h("input", { autocomplete: "off", placeholder: "FN 123456a" });
    let typed = { name: false, fn: false };
    let matches = [];
    let forceNew = false;
    let matchRequest = 0;
    let matchTimer;
    const newBox = h("div", {});
    const nextBtn = h("button", { class: "btn btn-ghost", type: "button", hidden: !creating, disabled: true }, "Anlegen und nächste Firma");
    const lookup = () => {
      clearTimeout(matchTimer);
      matchTimer = setTimeout(async () => {
        const mine = ++matchRequest;
        const params = new URLSearchParams({ kind: "company" });
        if (nameInput.value.trim()) params.set("name", nameInput.value.trim());
        if (fnInput.value.trim()) params.set("register_no", fnInput.value.trim());
        let result = [];
        if ([...params.keys()].length > 1) { try { result = await api(`/api/similar?${params}`); } catch { result = []; } }
        if (mine !== matchRequest) return;
        matches = result.filter((m) => m.strong);
        draw();
      }, 250);
    };
    nameInput.addEventListener("input", () => { typed.name = true; lookup(); draw(); });
    fnInput.addEventListener("input", () => { typed.fn = true; lookup(); draw(); });
    const useExisting = async (id) => {
      try {
        const target = await api(`/api/companies/${id}`);
        c = target;
        creating = false;
        existing = new Set(c.financials.map((f) => f.year));
        nextBtn.hidden = true;
        draw();
      } catch (err) { toast(err.message, true); }
    };

    const draw = () => {
      error.hidden = true;
      const pages = parseFirmenbuch(area.value);
      const byYear = new Map();
      for (const p of pages) if (p.year) byYear.set(p.year, { ...p, source: "Text" });
      // PDF-Jahre gehen vor; Vorjahreswerte nur, wenn das Jahr sonst nirgends vorkommt.
      const pdfMain = pdfs.flatMap((p) => p.filter((e) => !e.previous));
      for (const e of pdfMain) byYear.set(e.year, e);
      const skipped = [];
      for (const e of pdfs.flatMap((p) => p.filter((x) => x.previous))) {
        if (byYear.has(e.year) || existing.has(e.year)) skipped.push(e.year); else byYear.set(e.year, e);
      }
      const fixedYears = [...byYear.keys()];
      const newest = fixedYears.length ? Math.min(...fixedYears) - 1 : new Date().getFullYear() - 1;
      chained = suggestYears(shots, newest) || false;
      const entries = [...byYear.values(), ...shots.filter((s) => s.values.total_assets !== undefined)];
      found = entries.filter((e) => e.year).sort((a, b) => b.year - a.year);

      const notes = [];
      if (area.value.trim() && !pages.length) notes.push("Im Text ist keine Bilanz erkennbar. Bitte die ganze Seite kopieren (Cmd+A, dann Cmd+C).");
      if (pages.some((p) => !p.year)) notes.push("Bei einer Seite ist das Geschäftsjahr nicht erkennbar, sie wird übersprungen.");
      for (const s of shots) if (s.values.total_assets === undefined) notes.push(`${s.source}: keine Bilanz erkannt. Bitte den Bereich ab „Bilanzsumme“ aufnehmen.`);
      if (shots.length > 1 && !chained && shots.some((s) => !s.yearSet)) notes.push("Die Reihenfolge der Screenshots ließ sich nicht über den Vortrag bestimmen. Bitte die Jahre prüfen.");
      if (found.some((e) => e.check === false)) notes.push("Bei einem Eintrag ergeben die Posten nicht die Bilanzsumme. Bitte die Werte mit der Vorlage vergleichen.");
      for (const y of [...new Set(skipped)]) notes.push(`Vorjahr ${y} aus der PDF nicht übernommen, weil es dafür schon eine Bilanz gibt.`);
      if (found.some((e) => e.previous)) notes.push("Vorjahreswerte stehen in der PDF nur auf tausend Euro gerundet.");
      const years = found.map((e) => e.year);
      const twice = years.filter((y, i) => years.indexOf(y) !== i);
      if (twice.length) notes.push(`Das Jahr ${twice[0]} kommt doppelt vor.`);
      const fns = [...new Set(found.map((p) => p.fn).filter(Boolean))];
      const docNames = [...new Set(found.map((p) => p.name).filter(Boolean))];
      if (creating) {
        // Vorbelegen, solange nichts von Hand eingetragen wurde; neue Werte lösen die Dublettenprüfung aus.
        const before = nameInput.value + "|" + fnInput.value;
        if (!typed.name && docNames.length) nameInput.value = docNames[0];
        if (!typed.fn && fns.length === 1) fnInput.value = fns[0];
        if (before !== nameInput.value + "|" + fnInput.value) lookup();
        c.name = nameInput.value.trim();
        c.register_no = fnInput.value.trim();
      }
      const own = (c.register_no || "").toLowerCase().replace(/\s+/g, "");
      const wrongFn = own && fns.length === 1 && fns[0].toLowerCase().replace(/\s+/g, "") !== own;
      if (fns.length > 1) notes.push(`Die Unterlagen gehören zu verschiedenen Firmen (${fns.join(", ")}). Bitte nur eine Firma einfügen.`);
      if (wrongFn) notes.push(`Firmenbuchnummer passt nicht: im CRM ${c.register_no}, eingefügt ${fns[0]}.`);
      const names = [...new Set(found.map((p) => p.name).filter(Boolean))];
      const otherName = !creating && names.length > 0 && !names.some((n) => coreName(n).includes(coreName(c.name)) || coreName(c.name).includes(coreName(n)));
      const nameKey = names.join("|");
      if (confirmed && confirmed !== nameKey) confirmed = "";
      const confirmBox = otherName ? h("label", { class: "check" },
        h("input", { type: "checkbox", checked: confirmed === nameKey, onchange: (ev) => { confirmed = ev.target.checked ? nameKey : ""; draw(); } }),
        `Ja, die Unterlagen von „${names.join(", ")}“ gehören zu ${c.name}.`) : null;
      if (otherName) notes.push(`Andere Firma? In den Unterlagen steht ${names.join(", ")}, im CRM ${c.name}. Bitte bestätigen, bevor gespeichert wird.`);
      if (found.some((p) => p.missing.includes("Liquide Mittel"))) notes.push("Einzelposten fehlen. Auf openfirmenbuch.at vorher „Alle Werte aufklappen“ klicken.");

      if (creating && docNames.length > 1 && new Set(docNames.map(coreName)).size > 1) notes.push(`Die Unterlagen nennen verschiedene Firmen (${docNames.join(", ")}). Bitte nur eine Firma einfügen.`);
      const mixed = creating && new Set(docNames.map(coreName)).size > 1;
      const blockedNew = creating && (!c.name || (matches.length > 0 && !forceNew));
      save.disabled = !found.length || fns.length > 1 || wrongFn || twice.length > 0 || mixed || blockedNew || (otherName && confirmed !== nameKey);
      nextBtn.disabled = save.disabled;
      const what = found.length > 1 ? `${found.length} Jahre` : "Bilanz";
      save.textContent = creating ? `Firma anlegen, ${what} übernehmen` : (found.length > 1 ? `${found.length} Jahre übernehmen` : "Übernehmen");

      newBox.replaceChildren(creating ? h("div", { class: "newfirm" },
        h("div", { class: "form-row" }, field("Firmenname", nameInput), field("Firmenbuchnummer", fnInput)),
        found.length && !c.name ? h("p", { class: "small overdue" }, "Kein Firmenname in den Unterlagen gefunden. Bitte eintragen.") : null,
        matches.length ? h("div", { class: "dupes" },
          h("div", { class: "dupes-title" }, "Diese Firma gibt es wahrscheinlich schon:"),
          h("ul", {}, matches.map((m) => h("li", { class: "strong" },
            h("span", {}, m.label),
            h("span", { class: "small muted" }, m.reasons.join(", ")),
            h("button", { class: "btn btn-ghost btn-small", type: "button", onclick: () => useExisting(m.id) }, "Bilanz dort übernehmen")))),
          h("label", { class: "check" },
            h("input", { type: "checkbox", checked: forceNew, onchange: (ev) => { forceNew = ev.target.checked; draw(); } }),
            "Trotzdem neu anlegen, es ist eine andere Firma")) : null)
        : h("p", { class: "small muted" }, "Ziel: ", h("b", {}, c.name)));
      preview.replaceChildren(...[
        notes.length ? h("div", { class: "note small" }, notes.map((n) => h("div", {}, n))) : null,
        confirmBox,
        found.length ? h("div", { class: "tablewrap flat" }, h("table", {},
          h("thead", {}, h("tr", {}, h("th", {}, "Jahr"), h("th", {}, "Quelle"), FB_FIELDS.map(([, label]) => h("th", {}, label)), h("th", {}, ""))),
          h("tbody", {}, found.map((e) => h("tr", {},
            h("td", {}, e.source === "Text" || e.pdf ? e.year : h("input", {
                type: "number", class: "year-input", value: e.year, min: 1990, max: new Date().getFullYear() + 1,
                "aria-label": `Jahr für ${e.source}`,
                onchange: (ev) => { e.year = Number(ev.target.value) || null; e.yearSet = true; draw(); },
              }),
              existing.has(e.year) ? h("div", { class: "small overdue" }, "ersetzt") : null),
            h("td", {}, e.source, e.check === true ? h("div", { class: "small muted" }, "Summen stimmen") : null,
              e.check === false ? h("div", { class: "small overdue" }, "Summen prüfen") : null),
            FB_FIELDS.map(([key]) => h("td", {}, money(e.values[key]))),
            h("td", {}, e.source === "Text" || e.previous ? null : h("button", {
              class: "iconbtn", type: "button", "aria-label": `${e.source} entfernen`,
              onclick: () => {
                if (e.pdf) pdfs.splice(pdfs.findIndex((p) => p.includes(e)), 1); else shots.splice(shots.indexOf(e), 1);
                draw();
              },
            }, "Entfernen"))))))) : null].filter(Boolean));
    };

    let counter = 0;
    const readImage = async (file) => {
      const source = `Bild ${++counter}`;
      status.textContent = `${source} wird gelesen … Beim ersten Bild nach dem Start kann das bis zu 30 Sekunden dauern.`;
      status.hidden = false;
      try {
        const res = await fetch("/api/ocr", { method: "POST", headers: { "Content-Type": file.type || "image/png" }, body: file });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Die Texterkennung hat nicht funktioniert.");
        shots.push({ source, ...parseScreenshot(data.lines) });
      } catch (err) {
        error.textContent = `${source}: ${err.message}`;
        error.hidden = false;
        return;
      } finally {
        status.hidden = true;
      }
      draw();
      if (!error.hidden) error.hidden = true;
    };
    let pdfCounter = 0;
    const readPdf = async (file) => {
      const source = `PDF ${++pdfCounter}`;
      status.textContent = `${source} wird gelesen …`;
      status.hidden = false;
      try {
        const res = await fetch("/api/pdf", { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Die PDF ließ sich nicht lesen.");
        const parsed = parseAbschluss(data.text || "", source);
        if (!parsed) {
          throw new Error(data.text && data.text.trim()
            ? "Darin ist keine Bilanz erkennbar. Ist das ein Jahresabschluss aus dem Firmenbuch?"
            : "Die PDF enthält keinen Text, sie ist vermutlich eingescannt. Bitte Screenshot oder Seitentext verwenden.");
        }
        pdfs.push(parsed);
      } catch (err) {
        error.textContent = `${source}: ${err.message}`;
        error.hidden = false;
        return;
      } finally {
        status.hidden = true;
      }
      draw();
    };
    const readImages = async (files) => {
      for (const file of [...files]) {
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) await readPdf(file);
        else if (file.type.startsWith("image/")) await readImage(file);
      }
    };

    area.addEventListener("input", draw);
    area.addEventListener("paste", (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
      if (files.length) { e.preventDefault(); readImages(files); }
    });
    area.addEventListener("dragover", (e) => { e.preventDefault(); area.classList.add("over"); });
    area.addEventListener("dragleave", () => area.classList.remove("over"));
    area.addEventListener("drop", (e) => {
      area.classList.remove("over");
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) { e.preventDefault(); readImages(files); }
    });
    picker.addEventListener("change", () => { readImages(picker.files); picker.value = ""; });

    const store = async (next) => {
      const wasCreating = creating;
      save.disabled = true;
      nextBtn.disabled = true;
      try {
        const day = fmtDate(today());
        if (creating) {
          const sources = [...new Set(found.map((e) => e.pdf ? "Jahresabschluss (PDF)" : e.source === "Text" ? "Seitentext" : "Screenshot"))];
          c = await api("/api/companies", "POST", {
            name: c.name, register_no: c.register_no, status: "Potential", source: "Eigene Recherche",
            notes: `Angelegt aus dem Bilanz-Import (openfirmenbuch.at, ${sources.join(", ")}) am ${day}.`,
          });
          c.financials = c.financials || [];
        }
        for (const e of found) {
          const origin = e.origin ? `${e.origin}, eingefügt am ${day}`
            : e.source === "Text" ? `openfirmenbuch.at, eingefügt am ${day}` : `openfirmenbuch.at (Screenshot), eingefügt am ${day}`;
          const body = { year: e.year, origin, ...Object.fromEntries(FB_FIELDS.map(([key]) => [key, e.values[key] ?? ""])) };
          const old = c.financials.find((f) => f.year === e.year);
          if (old) await api(`/api/financials/${old.id}`, "PUT", body);
          else await api(`/api/companies/${c.id}/financials`, "POST", body);
        }
        const fn = found.find((p) => p.fn)?.fn;
        if (fn && !c.register_no) await api(`/api/companies/${c.id}`, "PUT", { register_no: fn });
        close();
        const done = found.length > 1 ? `${found.length} Bilanzen übernommen` : `Bilanz ${found[0].year} übernommen`;
        if (wasCreating) {
          toast(`${c.name} angelegt, ${done.replace(" übernommen", "")} übernommen`);
          if (next) firmenbuchDialog(null, refresh); else location.hash = `#/firma/${c.id}`;
        } else {
          toast(done);
          refresh();
        }
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        save.disabled = false;
        nextBtn.disabled = false;
        if (wasCreating && c.id) {  // Firma steht schon, nur die Bilanz fehlt: nicht doppelt anlegen
          creating = false;
          nextBtn.hidden = true;
        }
      }
    };
    save.addEventListener("click", () => store(false));
    nextBtn.addEventListener("click", () => store(true));
    draw();

    return h("div", { class: "form" },
      h("ol", { class: "steps small" },
        creating
          ? h("li", {}, "Firma auf ", h("a", { href: "https://openfirmenbuch.at/", target: "_blank", rel: "noopener noreferrer" }, "openfirmenbuch.at"),
            " suchen und „Alle Werte aufklappen“ klicken. Den Kopf der Seite mit Firmenname und FN mit aufnehmen, dann wird beides übernommen.")
          : h("li", {}, h("a", { href: firmenbuchUrl(c), target: "_blank", rel: "noopener noreferrer" }, "Firma auf openfirmenbuch.at öffnen"),
            " und dort „Alle Werte aufklappen“ klicken."),
        h("li", {}, "Je Geschäftsjahr einen Screenshot ab „Bilanzsumme“ aufnehmen (Ctrl+Shift+Cmd+4) und hier einfügen, die ganze Seite als Text kopieren (Cmd+A, Cmd+C) oder den Jahresabschluss als PDF herunterladen und hierher ziehen. Eine PDF enthält auch das Vorjahr."),
        h("li", {}, "Bis zu drei Jahre nacheinander einfügen, Jahre prüfen, übernehmen.")),
      area,
      h("div", {}, h("button", { class: "btn btn-ghost", type: "button", onclick: () => picker.click() }, "Bilder oder PDFs auswählen"), picker),
      status,
      newBox,
      preview,
      h("p", { class: "small muted hint" }, "Bilder und PDFs werden auf diesem Mac gelesen und nicht gespeichert. Übernommen werden nur die Bilanzzahlen und die Firmenbuchnummer, keine Angaben zu Personen."),
      error,
      h("div", { class: "form-end" },
        h("button", { class: "btn btn-ghost", type: "button", onclick: close }, "Abbrechen"),
        nextBtn,
        save));
  });
}

function ratingSection(c, refresh) {
  const r = c.rating;
  const summary = [];
  if (r.computed) {
    summary.push(`Aus der Bilanz ${r.year}: ${r.computed} (${r.score} von ${r.max} Punkten)`);
  } else {
    summary.push("Noch keine Bilanz erfasst.");
  }
  if (r.own) summary.push(`Eigene Einstufung: ${c.own_grade}`);

  const figures = r.computed ? h("dl", { class: "facts" },
    h("dt", {}, "Anlagefähige Mittel"), h("dd", {}, money(r.investable)),
    h("dt", {}, "Eigenkapitalquote"), h("dd", {}, r.equity_ratio === null ? "–" : `${r.equity_ratio.toLocaleString("de-AT")} %`),
    h("dt", {}, "Mittel minus Verbindl."), h("dd", {}, money(r.net_liquidity))) : null;

  const addButton = h("button", {
    class: "btn btn-ghost", type: "button",
    onclick: () => financialDialog(c.id, null, refresh),
  }, "Bilanz erfassen");

  return section("Bewertung",
    h("div", { class: "rating-head" }, gradeBadge(r.grade), h("div", {}, summary.map((s) => h("div", {}, s)))),
    r.explanation && r.explanation.length ? h("div", { class: "rating-text" },
      h("div", { class: "rating-text-head" }, `Begründung, Bilanz ${r.year}`),
      r.explanation.map((sentence) => h("p", { class: sentence.startsWith("Eigenkapital negativ") ? "overdue" : null }, sentence))) : null,
    figures,
    r.reasons.length ? h("ul", { class: "criteria" }, r.reasons.map((x) =>
      h("li", {}, h("span", {}, x.label), h("span", { class: "muted" }, `${x.points} / ${x.max}`)))) : null,
    r.gaps.length && r.computed ? h("p", { class: "small muted" }, `Fehlt noch: ${r.gaps.join(", ")}.`) : null,
    c.financials.length ? h("div", { class: "tablewrap flat" }, h("table", {},
      h("thead", {}, h("tr", {},
        h("th", {}, "Jahr"), h("th", {}, "Bilanzsumme"), h("th", {}, "Eigenkapital"), h("th", {}, "Liquide"),
        h("th", {}, "Wertp."), h("th", {}, "Verbindl."), h("th", {}, "Bilanzgewinn"), h("th", {}, ""))),
      h("tbody", {}, c.financials.map((f) => h("tr", {},
        h("td", {}, f.year), h("td", {}, money(f.total_assets)), h("td", {}, money(f.equity)),
        h("td", {}, money(f.liquid)), h("td", {}, money(f.securities)), h("td", {}, money(f.liabilities)),
        h("td", {}, money(f.retained)),
        h("td", { class: "nowrap" },
          h("button", { class: "iconbtn plain", type: "button", onclick: () => financialDialog(c.id, f, refresh) }, "Ändern"),
          h("button", {
            class: "iconbtn", type: "button",
            onclick: () => attempt(async () => { await api(`/api/financials/${f.id}`, "DELETE"); refresh(); }),
          }, "Löschen")))))) ) : null,
    h("div", { class: "form-end spaced" },
      h("a", {
        class: "btn btn-ghost", href: firmenbuchUrl(c), target: "_blank", rel: "noopener noreferrer",
        title: c.register_no ? "Öffnet die Firma auf openfirmenbuch.at" : "Sucht den Firmennamen auf openfirmenbuch.at",
      }, "Im Firmenbuch nachschlagen"),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => firmenbuchDialog(c, () => afterBalanceImport(c, refresh)) }, "Aus Firmenbuch einfügen"),
      addButton));
}

async function renderCompany(token, id) {
  const c = await api(`/api/companies/${id}`);
  if (token !== renderToken) return;
  const refresh = () => route();

  const statusSelect = selectEl(meta.statuses, c.status, {
    "aria-label": "Status ändern",
    onchange: (e) => attempt(async () => {
      await api(`/api/companies/${c.id}`, "PUT", { status: e.target.value });
      toast(`Status: ${e.target.value}`);
      refresh();
    }),
  });

  const deleteCompany = async () => {
    const yes = await confirmDialog(
      "Firma löschen?",
      `${c.name} wird mit Bilanzen, Verlauf und Aufgaben der Firma gelöscht. Die Personen bleiben im CRM, nur ihre Verbindung zur Firma entfällt. Töchter rücken nach oben.\n\nÄltere Sicherungen enthalten die Firma noch, bis sie durch neuere ersetzt werden.`,
      "Endgültig löschen");
    if (!yes) return;
    await attempt(async () => {
      await api(`/api/companies/${c.id}`, "DELETE");
      toast("Firma gelöscht");
      location.hash = "#/firmen";
    });
  };

  const people = section("Personen",
    c.people.length
      ? h("ul", { class: "rows links" }, c.people.map((p) => h("li", {},
          h("div", { class: "grow" },
            personLink(p),
            p.is_primary ? h("span", { class: "tag" }, "Hauptansprechperson") : null,
            p.private ? h("span", { class: "tag-area privat" }, "Privatkunde") : null,
            h("div", { class: "small muted" }, [p.kind, p.role, p.phone, p.email].filter(Boolean).join(" · "))),
          h("button", { class: "iconbtn plain", type: "button", onclick: () => attempt(() => linkDialog({ link: p }, refresh)) }, "Ändern"),
          h("button", {
            class: "iconbtn", type: "button", "aria-label": `Verbindung zu ${personName(p)} lösen`,
            onclick: () => attempt(async () => {
              const yes = await confirmDialog("Verbindung lösen?", `${personName(p)} bleibt als Person im CRM, gehört aber nicht mehr zu ${c.name}.`, "Verbindung lösen");
              if (!yes) return;
              await api(`/api/links/${p.link_id}`, "DELETE");
              refresh();
            }),
          }, "Lösen"))))
      : h("p", { class: "empty" }, "Noch keine Personen."),
    h("div", { class: "form-end spaced" },
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => attempt(() => linkDialog({ companyId: c.id }, refresh)) }, "Vorhandene Person verbinden"),
      h("button", {
        class: "btn btn-ghost", type: "button",
        onclick: () => attempt(() => contactDialog(null, refresh, { company_id: c.id })),
      }, "Neue Person")));

  const structure = section("Struktur",
    c.parent_id ? h("p", {}, h("span", { class: "muted small" }, "Muttergesellschaft: "), companyLink(c.parent_id, c.parent_name)) : null,
    c.children.length
      ? h("ul", { class: "rows" }, c.children.map((k) => h("li", {},
          h("div", { class: "grow" }, companyLink(k.id, k.name)), badge(k.status))))
      : h("p", { class: "empty" }, "Keine Tochtergesellschaften."),
    h("div", { class: "form-end spaced" },
      h("button", {
        class: "btn btn-ghost", type: "button",
        onclick: () => attempt(() => companyDialog(null, (saved) => { location.hash = `#/firma/${saved.id}`; }, { parent_id: c.id })),
      }, "Tochter anlegen")));

  const website = c.website ? h("a", { href: c.website, target: "_blank", rel: "noopener noreferrer" }, c.website.replace(/^https?:\/\//, "")) : "";
  const referrer = c.source === meta.referralSource && c.referrer_id
    ? h("a", { href: `#/empfehler/${c.referrer_id}` }, c.referrer_name) : "";

  const inWorklist = worklistCurrent() === c.id;
  setView(
    inWorklist ? worklistBar(c) : null,
    h("a", { class: "backlink", href: "#/firmen" }, "Zurück zu allen Firmen"),
    pageHead(c.status, c.name,
      statusSelect,
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => attempt(() => companyDialog(c, refresh)) }, "Bearbeiten"),
      h("button", { class: "btn btn-danger", type: "button", onclick: deleteCompany }, "Löschen")),
    h("div", { class: "detail" },
      h("div", { class: "stack" },
        ratingSection(c, refresh),
        activitySection(`/api/companies/${c.id}`, c.activities, refresh)),
      h("div", { class: "stack" },
        people,
        taskSection(`/api/companies/${c.id}`, c.tasks, refresh, { person: true }),
        structure,
        section("Angaben", facts([
          ["Rechtsform", c.legal_form],
          ["Firmenbuch", c.register_no],
          ["Branche", c.industry],
          ["Telefon", telLink(c.phone)],
          ["Telefon 2", telLink(c.phone2)],
          ["E-Mail", c.email ? h("a", { href: `mailto:${c.email}` }, c.email) : ""],
          ["Webseite", website],
          ["Anschrift", c.address],
          ["Quelle", c.source],
          ["Empfohlen von", referrer],
          ["Angelegt", fmtDate(c.created_at)],
        ])),
        c.notes ? section("Notizen", h("p", { class: "prewrap" }, c.notes)) : null)));
  if (inWorklist && worklist.openDialog) {
    worklist.openDialog = false;
    saveWorklist(worklist);
    firmenbuchDialog(c, () => afterBalanceImport(c, refresh));
  }
}

/* Kontakte */

function personRows(rows, { privateView = false } = {}) {
  return h("div", { class: "tablewrap" }, h("table", {},
    h("thead", {}, h("tr", {},
      h("th", {}, "Name"),
      privateView ? h("th", {}, "Haushalt") : h("th", {}, "Firmen"),
      h("th", {}, privateView ? "Ort" : "Privatkunde"),
      h("th", {}, "Status"),
      h("th", { class: "hide-sm" }, "E-Mail"), h("th", { class: "hide-sm" }, "Telefon"),
      h("th", {}, "Nächste Aufgabe"))),
    h("tbody", {}, rows.map((c) => h("tr", {},
      h("td", {}, personLink(c), privateView && c.company_names ? h("div", { class: "small muted" }, c.company_names) : null),
      privateView ? h("td", {}, householdTag(c)) : h("td", {}, c.company_names || "", c.household_id ? h("div", {}, householdTag(c)) : null),
      h("td", {}, privateView ? placeOf(c.address) : (c.private ? "ja" : "")),
      h("td", {}, c.private ? badge(c.status) : ""),
      h("td", { class: "hide-sm" }, c.email ? h("a", { href: `mailto:${c.email}` }, c.email) : ""),
      h("td", { class: "hide-sm" }, c.phone),
      h("td", {}, c.next_due
        ? h("span", { class: c.next_due < today() ? "overdue" : "" }, fmtDate(c.next_due))
        : (c.open_tasks ? "Ohne Datum" : "")))))));
}

async function renderContacts(token, params) {
  const search = h("input", { type: "search", placeholder: "Name, Firma, Haushalt, E-Mail, Telefon, Notizen", "aria-label": "Personen suchen", value: params.get("q") || "" });
  const results = h("div", {});
  const count = h("p", { class: "small muted tree-count" });

  async function load() {
    const query = new URLSearchParams();
    if (search.value.trim()) query.set("q", search.value.trim());
    if (area) query.set("bereich", area);
    const rows = await api(`/api/contacts?${query}`);
    if (token !== renderToken) return;
    count.textContent = `${rows.length} Personen`;
    results.replaceChildren(rows.length ? personRows(rows) : h("p", { class: "empty" }, "Keine Personen gefunden."));
  }

  let debounce;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => attempt(load), 200);
  });
  await load();
  if (token !== renderToken) return;
  setView(
    pageHead("Personen", area === "firma" ? "Personen mit Firmenbezug" : area === "privat" ? "Privatkunden" : "Alle Personen",
      h("a", { class: "btn btn-ghost", href: "/api/export.csv" }, "Als CSV exportieren")),
    areaNote(),
    h("div", { class: "tools" }, search),
    count,
    results);
}

async function renderPrivate(token, params) {
  const search = h("input", { type: "search", placeholder: "Name, Haushalt, Ort, E-Mail, Telefon", "aria-label": "Privatkunden suchen", value: params.get("q") || "" });
  const statusFilter = selectEl([["", "Alle Status"], ...meta.statuses], params.get("status") || "", { "aria-label": "Nach Status filtern" });
  const household = params.get("haushalt") || "";
  const results = h("div", {});
  const count = h("p", { class: "small muted tree-count" });

  async function load() {
    const query = new URLSearchParams({ bereich: "privat" });
    if (search.value.trim()) query.set("q", search.value.trim());
    if (statusFilter.value) query.set("status", statusFilter.value);
    if (household) query.set("haushalt", household);
    const rows = await api(`/api/contacts?${query}`);
    if (token !== renderToken) return rows;
    count.textContent = `${rows.length} Privatkunden`;
    results.replaceChildren(rows.length ? personRows(rows, { privateView: true })
      : h("p", { class: "empty" }, "Keine Privatkunden gefunden. Eine Person wird Privatkunde über „Bearbeiten“ und das Häkchen „Privatkunde“."));
    return rows;
  }
  let debounce;
  search.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(() => attempt(load), 200); });
  statusFilter.addEventListener("change", () => attempt(load));
  const rows = await load();
  if (token !== renderToken) return;
  const houseName = household && rows.length ? rows[0].household_name : "";
  setView(
    pageHead("Privatkunden", houseName ? `Haushalt ${houseName}` : "Privatkunden und Haushalte",
      h("button", {
        class: "btn btn-ghost", type: "button",
        onclick: () => attempt(() => contactDialog(null, (saved) => { location.hash = `#/kontakt/${saved.id}`; }, { private: true })),
      }, "Neuer Privatkunde")),
    household ? h("p", {}, h("a", { href: "#/privatkunden" }, "Alle Privatkunden zeigen")) : null,
    h("div", { class: "tools" }, search, statusFilter),
    count,
    results);
}

async function renderContact(token, id) {
  const c = await api(`/api/contacts/${id}`);
  if (token !== renderToken) return;
  const refresh = () => route();
  const roles = [c.private ? "Privatkunde" : "", c.companies.length ? "Firmenkontakt" : ""].filter(Boolean).join(" · ") || "Person";

  const statusSelect = c.private ? selectEl(meta.statuses, c.status, {
    "aria-label": "Status als Privatkunde ändern",
    onchange: (e) => attempt(async () => {
      await api(`/api/contacts/${c.id}`, "PUT", { status: e.target.value });
      toast(`Status: ${e.target.value}`);
      refresh();
    }),
  }) : null;

  const deleteContact = async () => {
    const yes = await confirmDialog(
      "Person löschen?",
      `${personName(c)} wird mit allen Einträgen, Aufgaben, Verbindungen und Einwilligungen gelöscht. Das lässt sich hier nicht rückgängig machen.\n\nÄltere Sicherungen enthalten die Person noch, bis sie durch neuere ersetzt werden.`,
      "Endgültig löschen");
    if (!yes) return;
    await attempt(async () => {
      await api(`/api/contacts/${c.id}`, "DELETE");
      toast("Person gelöscht");
      location.hash = c.companies.length ? `#/firma/${c.companies[0].id}` : "#/personen";
    });
  };

  const referrer = c.private && c.source === meta.referralSource && c.referrer_id
    ? h("a", { href: `#/empfehler/${c.referrer_id}` }, c.referrer_name) : "";
  const removeButton = (label, path, text) => h("button", {
    class: "iconbtn", type: "button", "aria-label": label,
    onclick: () => attempt(async () => {
      const yes = await confirmDialog(label, text, "Lösen");
      if (!yes) return;
      await api(path, "DELETE");
      refresh();
    }),
  }, "Lösen");

  const connections = section("Verbindungen",
    h("div", { class: "subhead" }, "Firmen"),
    c.companies.length
      ? h("ul", { class: "rows links" }, c.companies.map((f) => h("li", {},
          h("div", { class: "grow" }, companyLink(f.id, f.name),
            f.is_primary ? h("span", { class: "tag" }, "Hauptansprechperson") : null,
            h("div", { class: "small muted" }, [f.kind, f.role].filter(Boolean).join(" · "))),
          badge(f.status),
          h("button", { class: "iconbtn plain", type: "button", onclick: () => attempt(() => linkDialog({ link: f }, refresh)) }, "Ändern"),
          removeButton(`Verbindung zu ${f.name} lösen`, `/api/links/${f.link_id}`, `${personName(c)} gehört dann nicht mehr zu ${f.name}. Die Person bleibt erhalten.`))))
      : h("p", { class: "empty" }, "Mit keiner Firma verbunden."),
    h("div", { class: "subhead" }, "Haushalt"),
    c.household_id
      ? h("div", {}, householdTag(c),
          c.household_members.length
            ? h("ul", { class: "rows" }, c.household_members.map((m) => h("li", {},
                h("div", { class: "grow" }, personLink(m)), m.private ? badge(m.status) : null)))
            : h("p", { class: "small muted" }, "Noch niemand sonst in diesem Haushalt."))
      : h("p", { class: "empty" }, "Keinem Haushalt zugeordnet. Über „Bearbeiten“ eintragen."),
    h("div", { class: "subhead" }, "Personen"),
    c.relations.length
      ? h("ul", { class: "rows links" }, c.relations.map((r) => h("li", {},
          h("div", { class: "grow" }, h("span", { class: "muted" }, `${r.label} `), personLink(r.other),
            r.note ? h("div", { class: "small muted" }, r.note) : null),
          removeButton(`Verbindung zu ${personName(r.other)} lösen`, `/api/relations/${r.id}`, "Die Verbindung wird bei beiden Personen entfernt."))))
      : h("p", { class: "empty" }, "Keine Verbindungen zu anderen Personen."),
    h("div", { class: "form-end spaced" },
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => attempt(() => linkDialog({ contactId: c.id }, refresh)) }, "Mit Firma verbinden"),
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => attempt(() => relationDialog(c, refresh)) }, "Person verbinden")));

  const stateLabel = (state) => h("span", { class: `state-${state || "keine"}` }, meta.consentStates[state || ""]);
  const consents = section("Werbe-Einwilligungen",
    h("p", { class: "small muted" }, "Newsletter, Mailings und Werbeanrufe nur mit nachweisbarer Einwilligung. Widerrufe gelten sofort."),
    h("div", { class: "consent-grid" }, c.consents.channels.map((k) => h("div", { class: "consent-row" },
      h("div", {}, h("div", {}, k.label),
        h("div", { class: "small muted" }, stateLabel(k.state), k.since ? ` seit ${fmtDate(k.since.slice(0, 10))}` : "")),
      k.state === "erteilt"
        ? h("button", { class: "btn btn-ghost", type: "button", onclick: () => consentDialog(c, k.channel, "widerrufen", refresh) }, "Widerruf erfassen")
        : h("button", { class: "btn btn-ghost", type: "button", onclick: () => consentDialog(c, k.channel, "erteilt", refresh) }, "Einwilligung erfassen")))),
    c.consents.events.length ? h("details", {},
      h("summary", { class: "small" }, `Nachweis (${c.consents.events.length} Einträge)`),
      h("ul", { class: "rows" }, c.consents.events.map((e) => h("li", {},
        h("div", { class: "grow" },
          h("div", { class: "small muted" }, [fmtDate(e.at.slice(0, 10)), meta.channels[e.channel], e.source].filter(Boolean).join(" · ")),
          h("div", {}, stateLabel(e.state), e.proof ? ` – ${e.proof}` : "")))))) : null);

  const defaultArea = c.companies.length && !c.private ? "firma" : "privat";
  setView(
    c.companies.length === 1 && !c.private
      ? h("a", { class: "backlink", href: `#/firma/${c.companies[0].id}` }, `Zurück zu ${c.companies[0].name}`)
      : h("a", { class: "backlink", href: c.private ? "#/privatkunden" : "#/personen" }, c.private ? "Zurück zu den Privatkunden" : "Zurück zu allen Personen"),
    pageHead(c.private ? `${roles} · ${c.status}` : roles, personName(c),
      statusSelect,
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => attempt(() => contactDialog(c, refresh)) }, "Bearbeiten"),
      h("button", { class: "btn btn-danger", type: "button", onclick: deleteContact }, "Löschen")),
    h("div", { class: "detail" },
      h("div", { class: "stack" },
        activitySection(`/api/contacts/${c.id}`, c.activities, refresh, { areaChoice: defaultArea }),
        connections),
      h("div", { class: "stack" },
        taskSection(`/api/contacts/${c.id}`, c.tasks, refresh, { areaChoice: defaultArea }),
        section("Angaben", facts([
          ["E-Mail", c.email ? h("a", { href: `mailto:${c.email}` }, c.email) : ""],
          ["Telefon", telLink(c.phone)],
          ["Anschrift", c.address],
          ["Privatkunde", c.private ? `ja, ${c.status}` : "nein"],
          ["Quelle", c.private ? c.source : ""],
          ["Empfohlen von", referrer],
          ["Datenschutz", [c.consent, c.consent_date ? `, ${fmtDate(c.consent_date)}` : ""].join("")],
          ["Angelegt", fmtDate(c.created_at)],
        ])),
        consents,
        c.notes ? section("Notizen", h("p", { class: "prewrap" }, c.notes)) : null)));
}

/* Einstellungen: Daten übertragen und Zugänge für die Webseite */

async function renderSettings(token) {
  const [data, security] = await Promise.all([api("/api/apikeys"), api("/api/sessions")]);
  if (token !== renderToken) return;
  const refresh = () => route();
  const newKey = () => openDialog("Neuer Zugang für die Webseite", (close) => {
    const name = h("input", { placeholder: "zum Beispiel Webseite meerkoetter.at" });
    const boxes = Object.entries(meta.apiScopes).map(([key, label]) => {
      const box = h("input", { type: "checkbox", value: key, checked: key === "newsletter" });
      return { key, box, row: h("label", { class: "check" }, box, label) };
    });
    const out = h("div", { hidden: true });
    const form = dialogForm(close, async () => {
      const result = await api("/api/apikeys", "POST", { name: name.value, scopes: boxes.filter((b) => b.box.checked).map((b) => b.key) });
      form.replaceChildren(
        h("p", {}, "Der Zugangsschlüssel wird nur jetzt angezeigt. Bitte sofort in die Einstellungen der Webseite übernehmen und nirgends sonst ablegen."),
        h("div", { class: "tokenbox" }, result.token),
        h("div", { class: "form-end" },
          h("button", { class: "btn btn-ghost", type: "button", onclick: () => navigator.clipboard?.writeText(result.token).then(() => toast("Kopiert")) }, "Kopieren"),
          h("button", { class: "btn", type: "button", onclick: () => { close(); refresh(); } }, "Fertig")));
    },
      field("Name", name),
      h("div", {}, h("div", { class: "subhead" }, "Darf"), boxes.map((b) => b.row)),
      h("p", { class: "small muted" }, "Gib nur frei, was die Webseite braucht. Für Newsletter-Anmeldungen genügt „Newsletter“."),
      out);
    return form;
  });

  setView(
    pageHead("Einstellungen", "Daten und Schnittstelle"),
    h("div", { class: "grid2" },
      h("div", { class: "stack" },
        dataSection(),
        section("Hinweise zum Datenschutz",
          h("ul", { class: "small" },
            h("li", {}, "Werbe-Einwilligungen werden je Person und Kanal mit Datum, Herkunft und Nachweis gespeichert. Einträge im Nachweis werden nie geändert."),
            h("li", {}, "Newsletter-Anmeldungen über die Webseite laufen als Double-Opt-in: erst der Klick auf den Bestätigungslink macht daraus eine Einwilligung."),
            h("li", {}, "Jeder Newsletter braucht den persönlichen Abmeldelink aus der Empfängerliste. Eine Abmeldung wirkt sofort."),
            h("li", {}, "Rechtliche Fragen (TKG, DSGVO) bitte mit Kammer oder Rechtsberatung klären.")))),
      h("div", { class: "stack" },
        section("Schnittstelle für die Webseite",
          h("p", { class: "small muted" }, "Die Webseite greift über eigene Zugangsschlüssel auf freigegebene Daten zu, zum Beispiel für Newsletter-Anmeldungen. Erreichbar ist die Schnittstelle erst, wenn das CRM zentral auf einem Server läuft. Bis dahin nur auf diesem Rechner."),
          data.keys.length
            ? h("ul", { class: "rows" }, data.keys.map((k) => h("li", {},
                h("div", { class: "grow" },
                  h("b", {}, k.name), h("span", { class: "small muted" }, ` ${k.prefix}…`),
                  h("div", { class: "small muted" }, [
                    `Darf: ${k.scopes.split(",").join(", ")}`,
                    `angelegt ${fmtDate(k.created_at.slice(0, 10))}`,
                    k.last_used_at ? `zuletzt genutzt ${fmtDate(k.last_used_at.slice(0, 10))}` : "noch nie genutzt",
                  ].join(" · ")),
                  k.revoked_at ? h("div", { class: "small overdue" }, `Gesperrt am ${fmtDate(k.revoked_at.slice(0, 10))}`) : null),
                k.revoked_at ? null : h("button", {
                  class: "iconbtn", type: "button",
                  onclick: () => attempt(async () => {
                    const yes = await confirmDialog("Zugang sperren?", `Die Webseite kann mit „${k.name}“ danach nicht mehr zugreifen.`, "Sperren");
                    if (!yes) return;
                    await api(`/api/apikeys/${k.id}`, "DELETE");
                    refresh();
                  }),
                }, "Sperren"))))
            : h("p", { class: "empty" }, "Noch kein Zugang angelegt."),
          h("div", { class: "form-end spaced" }, h("button", { class: "btn btn-ghost", type: "button", onclick: newKey }, "Neuer Zugang"))),
        security.mode === "server" ? section("Anmeldungen",
          h("div", { class: "subhead" }, "Angemeldete Geräte"),
          h("ul", { class: "rows" }, security.sessions.map((x) => h("li", {},
            h("div", { class: "grow small" }, h("b", {}, x.agent.replace(/\(.*?\)/g, "").slice(0, 60) || "Unbekanntes Gerät"),
              h("div", { class: "muted" }, `seit ${x.created_at.replace("T", " ").slice(0, 16)} · zuletzt ${x.last_seen.replace("T", " ").slice(0, 16)}`)),
            h("button", { class: "iconbtn", type: "button", onclick: () => attempt(async () => { await api(`/api/sessions/${x.id}`, "DELETE"); refresh(); }) }, "Abmelden")))),
          h("div", { class: "subhead" }, "Letzte Anmeldeversuche"),
          h("ul", { class: "rows" }, security.logins.map((l) => h("li", {},
            h("div", { class: "grow small" }, `${l.at.replace("T", " ").slice(0, 16)} · ${l.email} · ${l.ip}`,
              l.reason ? h("div", { class: "muted" }, l.reason) : null),
            h("span", { class: `small ${l.ok ? "muted" : "overdue"}` }, l.ok ? "ok" : "abgelehnt"))))) : null,
        data.log.length ? section("Letzte Zugriffe",
          h("ul", { class: "rows" }, data.log.map((l) => h("li", {},
            h("div", { class: "grow small" }, `${l.at.replace("T", " ")} · ${l.name || "ohne gültigen Schlüssel"} · ${l.method} ${l.path}`),
            h("span", { class: `small ${l.status >= 400 ? "overdue" : "muted"}` }, l.status))))) : null)));
}

/* Pipeline */

async function renderPipeline(token) {
  const items = await api(`/api/pipeline${areaParam()}`);
  if (token !== renderToken) return;

  const columns = meta.pipeline.map((status) => {
    const inColumn = items.filter((i) => i.status === status);
    const col = h("section", {
      class: "col",
      ondragover: (e) => { e.preventDefault(); col.classList.add("over"); },
      ondragleave: (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("over"); },
      ondrop: (e) => {
        e.preventDefault();
        col.classList.remove("over");
        const key = e.dataTransfer.getData("text/plain");
        const dragged = items.find((i) => `${i.kind}:${i.id}` === key);
        if (!dragged || dragged.status === status) return;
        const path = dragged.kind === "company" ? "companies" : "contacts";
        attempt(async () => {
          await api(`/api/${path}/${dragged.id}`, "PUT", { status });
          toast(`${dragged.name}: ${status}`);
          route();
        });
      },
    },
      h("h2", {}, status, h("span", {}, inColumn.length)),
      inColumn.map((i) => {
        const tile = h("a", {
          class: "tile", href: i.kind === "company" ? `#/firma/${i.id}` : `#/kontakt/${i.id}`, draggable: "true",
          ondragstart: (e) => { e.dataTransfer.setData("text/plain", `${i.kind}:${i.id}`); tile.classList.add("dragging"); },
          ondragend: () => tile.classList.remove("dragging"),
        },
          h("div", { class: "tile-head" }, h("b", {}, i.name), gradeBadge(i.grade)),
          i.sub ? h("div", { class: "small muted" }, i.sub) : null,
          i.next_due ? h("div", { class: `small ${i.next_due < today() ? "overdue" : "muted"}` }, `Aufgabe: ${fmtDate(i.next_due)}`) : null);
        return tile;
      }));
    return col;
  });

  const outside = items.filter((i) => !meta.pipeline.includes(i.status)).length;
  setView(
    pageHead("Pipeline", "Vom Potential zur Kundschaft"),
    areaNote(),
    h("div", { class: "board" }, columns),
    outside ? h("p", { class: "small muted" }, `${outside} weitere ruhend oder ohne Interesse.`) : null);
}

/* Empfehler */

async function renderReferrers(token) {
  const rows = await api("/api/referrers");
  if (token !== renderToken) return;
  setView(
    pageHead("Empfehler", "Empfehler und Provisionen",
      h("button", {
        class: "btn btn-ghost", type: "button",
        onclick: () => referrerDialog(null, (saved) => { location.hash = `#/empfehler/${saved.id}`; }),
      }, "Neuer Empfehler")),
    h("div", { class: "note" }, "Grundgerüst: Hier hältst du fest, wer empfohlen hat, was vereinbart ist und welche Beträge offen sind. Eine Berechnung oder Abrechnung gibt es noch nicht."),
    rows.length
      ? h("div", { class: "tablewrap" }, h("table", {},
          h("thead", {}, h("tr", {},
            h("th", {}, "Name"), h("th", {}, "Provision vereinbart"), h("th", {}, "Empfehlungen"),
            h("th", {}, "Offen"), h("th", {}, "Bezahlt"))),
          h("tbody", {}, rows.map((r) => h("tr", {},
            h("td", {}, h("a", { class: "name", href: `#/empfehler/${r.id}` }, r.name)),
            h("td", {}, r.commission_agreed ? "Ja" : "Nein"),
            h("td", {}, r.referred),
            h("td", {}, euroCents.format(r.open_cents / 100)),
            h("td", {}, euroCents.format(r.paid_cents / 100)))))))
      : h("p", { class: "empty" }, "Noch keine Empfehler."));
}

async function renderReferrer(token, id) {
  const r = await api(`/api/referrers/${id}`);
  if (token !== renderToken) return;
  const refresh = () => route();

  const deleteReferrer = async () => {
    const yes = await confirmDialog("Empfehler löschen?", `${r.name} wird gelöscht. Empfohlene Firmen und Personen bleiben erhalten, die Zuordnung entfällt.`, "Endgültig löschen");
    if (!yes) return;
    await attempt(async () => {
      await api(`/api/referrers/${r.id}`, "DELETE");
      toast("Empfehler gelöscht");
      location.hash = "#/empfehler";
    });
  };

  const amount = h("input", { inputmode: "decimal", placeholder: "Betrag in Euro", "aria-label": "Betrag in Euro" });
  const when = h("input", { type: "date", value: today(), "aria-label": "Datum" });
  const customer = selectEl([["", "Ohne Zuordnung"],
    ...r.companies.map((c) => [`company:${c.id}`, c.name]),
    ...r.people.map((p) => [`contact:${p.id}`, personName(p)])], "", { "aria-label": "Empfohlener Kunde" });
  const state = selectEl(meta.commissionStates, "Offen", { "aria-label": "Stand" });
  const note = h("input", { placeholder: "Notiz", "aria-label": "Notiz" });
  const form = h("form", {
    class: "addform",
    onsubmit: (e) => {
      e.preventDefault();
      attempt(async () => {
        await api(`/api/referrers/${r.id}/commissions`, "POST", {
          amount: amount.value, date: when.value, customer: customer.value, status: state.value, note: note.value,
        });
        refresh();
      });
    },
  },
    h("div", { class: "inline" }, amount, when),
    h("div", { class: "inline" }, customer, state),
    h("div", { class: "taskadd single" }, note, h("button", { class: "btn", type: "submit" }, "Eintragen")));

  const open = r.commissions.filter((c) => c.status !== "Bezahlt").reduce((n, c) => n + c.amount_cents, 0);
  const paid = r.commissions.filter((c) => c.status === "Bezahlt").reduce((n, c) => n + c.amount_cents, 0);

  setView(
    h("a", { class: "backlink", href: "#/empfehler" }, "Zurück zu allen Empfehlern"),
    pageHead("Empfehler", r.name,
      h("button", { class: "btn btn-ghost", type: "button", onclick: () => referrerDialog(r, refresh) }, "Bearbeiten"),
      h("button", { class: "btn btn-danger", type: "button", onclick: deleteReferrer }, "Löschen")),
    h("div", { class: "detail" },
      section("Provisionen",
        h("p", { class: "small muted" }, `Offen ${euroCents.format(open / 100)} · Bezahlt ${euroCents.format(paid / 100)}`),
        form,
        r.commissions.length
          ? h("ul", { class: "rows" }, r.commissions.map((c) => h("li", {},
              h("div", { class: "grow" },
                h("b", {}, euroCents.format(c.amount_cents / 100)),
                h("div", { class: "small muted" }, [fmtDate(c.date), c.customer_label, c.note].filter(Boolean).join(" · "))),
              selectEl(meta.commissionStates, c.status, {
                class: "compact", "aria-label": "Stand ändern",
                onchange: (e) => attempt(async () => {
                  await api(`/api/commissions/${c.id}`, "PUT", { status: e.target.value });
                  refresh();
                }),
              }),
              h("button", {
                class: "iconbtn", type: "button", "aria-label": "Provision löschen",
                onclick: () => attempt(async () => { await api(`/api/commissions/${c.id}`, "DELETE"); refresh(); }),
              }, "Löschen"))))
          : h("p", { class: "empty" }, "Noch keine Provisionen.")),
      h("div", { class: "stack" },
        section("Empfehlungen",
          r.companies.length || r.people.length
            ? h("ul", { class: "rows" },
                r.companies.map((c) => h("li", {}, h("div", { class: "grow" }, companyLink(c.id, c.name)), badge(c.status))),
                r.people.map((p) => h("li", {}, h("div", { class: "grow" }, personLink(p)), badge(p.status))))
            : h("p", { class: "empty" }, "Noch keine Empfehlungen zugeordnet.")),
        section("Angaben", facts([
          ["Provision", r.commission_agreed ? "Vereinbart" : "Nicht vereinbart"],
          ["Vereinbarung", r.commission_terms],
          ["Vereinbart am", fmtDate(r.agreement_date)],
          ["E-Mail", r.email ? h("a", { href: `mailto:${r.email}` }, r.email) : ""],
          ["Telefon", r.phone],
        ])),
        r.notes ? section("Notizen", h("p", { class: "prewrap" }, r.notes)) : null)));
}

/* Suche in der Kopfzeile */

function initGlobalSearch() {
  const box = document.getElementById("global-search");
  const input = h("input", {
    type: "search", id: "global-search-input", placeholder: "Alles durchsuchen", autocomplete: "off",
    "aria-label": "Firmen, Personen und Empfehler durchsuchen", role: "combobox",
    "aria-expanded": "false", "aria-controls": "global-search-results", title: "Taste / springt hierher",
  });
  const panel = h("div", { class: "search-panel", id: "global-search-results", role: "listbox", hidden: true });
  box.append(input, panel);
  let timer;
  let request = 0;
  let active = -1;

  const links = () => [...panel.querySelectorAll("a")];
  const close = () => {
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const mark = (index) => {
    const all = links();
    if (!all.length) return;
    active = (index + all.length) % all.length;
    all.forEach((a, i) => a.classList.toggle("active", i === active));
    all[active].scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", all[active].id);
  };
  const row = (href, title, sub, trailing) => h("a", { href, role: "option", id: `treffer-${href.replace(/\W/g, "")}` },
    h("span", { class: "search-text" }, h("b", {}, title), sub ? h("span", { class: "small muted" }, sub) : null),
    trailing);
  const group = (title, data, render) => data.total ? [
    h("div", { class: "search-group" }, title,
      h("span", {}, data.total > data.items.length ? `${data.items.length} von ${data.total}` : data.total)),
    data.items.map(render),
  ] : null;

  async function run() {
    const q = input.value.trim();
    const mine = ++request;
    if (q.length < 2) { close(); return; }
    let found;
    try {
      found = await api(`/api/search?q=${encodeURIComponent(q)}`);
    } catch {
      if (mine !== request) return;
      panel.replaceChildren(h("p", { class: "search-empty" }, "Die Suche antwortet nicht. Bitte das CRM neu starten."));
      panel.hidden = false;
      return;
    }
    if (mine !== request) return;
    const content = [
      group("Firmen", found.companies, (c) => row(`#/firma/${c.id}`, c.name, [c.address, c.phone].filter(Boolean).join(" · "), badge(c.status))),
      group("Personen", found.people, (p) => row(`#/kontakt/${p.id}`, personName(p),
        [p.company_names, p.household_name ? `Haushalt ${p.household_name}` : "", p.private && !p.company_names ? "Privatkunde" : ""].filter(Boolean).join(" · "),
        p.private ? badge(p.status) : null)),
      group("Empfehler", found.referrers, (r) => row(`#/empfehler/${r.id}`, r.name, [r.phone, r.email].filter(Boolean).join(" · "))),
    ].flat(Infinity).filter(Boolean);
    panel.replaceChildren(...(content.length ? content : [h("p", { class: "search-empty" }, "Nichts gefunden.")]));
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    active = -1;
  }

  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 180); });
  input.addEventListener("focus", () => { if (input.value.trim().length >= 2) run(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); mark(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); mark(active - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const all = links();
      if (all.length) all[active >= 0 ? active : 0].click();
    } else if (e.key === "Escape") {
      if (panel.hidden) input.blur();
      close();
    }
  });
  panel.addEventListener("click", (e) => {
    if (e.target.closest("a")) { input.value = ""; request++; close(); input.blur(); }
  });
  document.addEventListener("click", (e) => { if (!box.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest("input, textarea, select, dialog");
    if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); input.focus(); }
  });
}

/* Navigation */

async function route() {
  const token = ++renderToken;
  const [path, queryString] = (location.hash.slice(1) || "/").split("?");
  const params = new URLSearchParams(queryString || "");
  const contact = path.match(/^\/kontakt\/(\d+)$/);
  const company = path.match(/^\/firma\/(\d+)$/);
  const referrer = path.match(/^\/empfehler\/(\d+)$/);
  let active = "overview";
  if (path === "/pipeline") active = "pipeline";
  else if (path === "/firmen" || company) active = "companies";
  else if (path === "/privatkunden") active = "private";
  else if (path === "/personen" || path === "/kontakte" || contact) active = "contacts";
  else if (path === "/empfehler" || referrer) active = "referrers";
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const on = a.dataset.nav === active;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  try {
    if (contact) await renderContact(token, contact[1]);
    else if (company) await renderCompany(token, company[1]);
    else if (referrer) await renderReferrer(token, referrer[1]);
    else if (path === "/firmen") await renderTree(token);
    else if (path === "/personen" || path === "/kontakte") await renderContacts(token, params);
    else if (path === "/privatkunden") await renderPrivate(token, params);
    else if (path === "/einstellungen") await renderSettings(token);
    else if (path === "/pipeline") await renderPipeline(token);
    else if (path === "/empfehler") await renderReferrers(token);
    else await renderOverview(token);
  } catch (err) {
    if (token === renderToken) {
      setView(h("div", { class: "note" }, err.message), h("a", { href: "#/" }, "Zur Übersicht"));
    }
  }
}

async function start() {
  try {
    const status = await fetch("/auth/status").then((r) => r.json());
    authMode = status.mode;
    if (authMode === "server") {
      if (!status.user) { showLogin(); return; }
      document.getElementById("top-actions").append(
        h("button", { class: "btn btn-ghost", type: "button", title: `Angemeldet als ${status.user.email}`, onclick: logout }, "Abmelden"));
    }
  } catch { /* ältere Version oder lokal: ohne Anmeldung weiter */ }
  try {
    meta = await api("/api/meta");
  } catch (err) {
    setView(h("div", { class: "note" }, err.message));
    return;
  }
  document.getElementById("new-contact").addEventListener("click", () => attempt(() =>
    contactDialog(null, (saved) => { location.hash = `#/kontakt/${saved.id}`; })));
  document.getElementById("new-company").addEventListener("click", () => attempt(() =>
    companyDialog(null, (saved) => { location.hash = `#/firma/${saved.id}`; })));
  initGlobalSearch();
  initAreaFilter();
  window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });
  route();
}

start();

// Installierbare Webapp: nur über HTTPS oder auf dem eigenen Rechner, nicht im App-Fenster.
if ("serviceWorker" in navigator && !window.pywebview && (location.protocol === "https:" || location.hostname === "127.0.0.1" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("/sw.js").catch(() => { /* ohne Offline-Start weiter */ });
}
