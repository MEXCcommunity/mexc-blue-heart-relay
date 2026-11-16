"use strict";

const land = __LAND__;
const brandCells = __MARK__;
const width = 800;
const height = 466;
const pixelSize = 4.4;
const isFile = location.protocol === "file:" || __LOCAL_ONLY__;
const memoryKey = "mexc-blue-heart-relay-v1";
const validRef = /^[a-f0-9]{32}$/;
const validUid = /^[0-9]{1,32}$/;
const params = new URL(location.href).searchParams;
const ref = params.get("ref") || "";
const source = (params.get("utm_source") || "").slice(0, 40);
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const $ = (id) => document.getElementById(id);
const canvas = $("art");
const ctx = canvas.getContext("2d");
const viewport = $("viewport");
const camera = $("camera");
const landLayer = document.createElement("canvas");
landLayer.width = width;
landLayer.height = height;
const landCtx = landLayer.getContext("2d");
let state = { count: 0, mine: null, incoming: null, relays: 0, notes: [] };
let ready = false;
let busy = false;
let mutation = 0;
let zoom = 1;
let selected = null;
let tipEntry = null;
let pinned = false;
let currentUrl = "";
let toastTimer;
let suppressFocus = false;

const mix = (x, y) => {
  const v = Math.imul(x + 33, 2246822519) ^ Math.imul(y + 51, 3266489917);
  return (v ^ v >>> 16) >>> 0;
};
const pixelColor = (i) => ["#5799fd", "#76b4ff", "#68a7ff", "#4084f1", "#88c5ff"][i % 5];
const positions = brandCells.slice().sort((a, b) => mix(...a) - mix(...b));
const capacity = positions.length;
const campaignEndedMessage = "Thank you for participating! The campaign has ended.";
const campaignEnded = () => state.count >= capacity;
const number = new Intl.NumberFormat("en-US");
const position = (entry) => positions[entry.position - 1];

function paintLand() {
  const silhouette = new Path2D();
  for (const polygon of land) {
    for (const ring of polygon) {
      const [first, ...rest] = ring;
      silhouette.moveTo(first[0], first[1]);
      for (const [x, y] of rest) silhouette.lineTo(x, y);
      silhouette.closePath();
    }
  }
  for (let y = 27; y < height - 29; y += 5) {
    for (let x = 16; x < width - 14; x += 5) {
      const onLand = landCtx.isPointInPath(silhouette, x, y, "evenodd");
      landCtx.fillStyle = onLand ? (mix(x, y) % 11 === 0 ? "#38587c" : "#2a4366") : "#223551";
      const r = onLand ? 1.55 : .75;
      landCtx.fillRect(x - r / 2, y - r / 2, r, r);
    }
  }
}

function paint() {
  const scale = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(viewport.clientWidth * scale));
  const h = Math.max(1, Math.round(viewport.clientHeight * scale));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(w / width, 0, 0, h / height, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(landLayer, 0, 0);
  positions.forEach(([x,y], i) => {
    const lit = i < state.count;
    if (lit) {
      ctx.fillStyle = "#4884ec38";
      ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
    }
    ctx.fillStyle = lit ? pixelColor(i) : "#40608c";
    ctx.fillRect(x - pixelSize / 2, y - pixelSize / 2, pixelSize, pixelSize);
  });
  const focus = selected || state.mine || state.incoming;
  const cell = focus && position(focus);
  if (!cell) return;
  const [x,y] = cell;
  ctx.fillStyle = "#b6d7ff44";
  ctx.fillRect(x - 9, y - 9, 18, 18);
  ctx.strokeStyle = "#a7ceff";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x - 7, y - 7, 14, 14);
  ctx.fillStyle = "#e9f4ff";
  ctx.fillRect(x - 3, y - 3, 6, 6);
}

function noteName(note) {
  return note.handle ? "@" + note.handle : "Anonymous";
}
function markerAnchor(entry) {
  const [x,y] = position(entry) ?? [width / 2, height / 2];
  const scale = zoom;
  const shiftX = (x - width / 2) * scale + width / 2;
  const shiftY = (y - height / 2) * scale + height / 2;
  return [shiftX * viewport.clientWidth / width, shiftY * viewport.clientHeight / height];
}
function hideTip() {
  $("tip").hidden = true;
  pinned = false;
  tipEntry = null;
  for (const marker of $("markers").children) marker.classList.remove("active");
}
function showTip(entry, hold) {
  tipEntry = entry;
  pinned = hold;
  const tip = $("tip");
  $("tip-name").textContent = entry.message ? noteName(entry) : "This pixel is lit";
  $("tip-message").textContent = entry.message || "💪💙";
  const label = $("tip-label");
  label.textContent = entry.handle ? "Unverified X handle" : "";
  label.hidden = !label.textContent;
  tip.hidden = false;
  const [x,y] = markerAnchor(entry);
  tip.style.left = Math.max(12, Math.min(x - tip.offsetWidth / 2, viewport.clientWidth - tip.offsetWidth - 12)) + "px";
  const below = y < tip.offsetHeight + 64;
  tip.style.top = Math.max(9, Math.min(below ? y + 11 : y - tip.offsetHeight - 45, viewport.clientHeight - tip.offsetHeight - 9)) + "px";
  for (const marker of $("markers").children) marker.classList.toggle("active", marker.dataset.share === entry.share);
}
function choose(entry, scroll = false, reveal = true) {
  selected = entry;
  if (zoom !== 1) setZoom(1);
  paint();
  if (reveal) showTip(entry, true);
  if (scroll) viewport.scrollIntoView({ block:"nearest", behavior:motion.matches ? "auto" : "smooth" });
}
function renderMarkers() {
  const current = $("markers");
  const candidates = [state.mine, state.incoming, ...state.notes].filter((note) => note?.message && position(note));
  const distinct = new Map(candidates.map((note) => [note.share, note]));
  const used = [];
  const fragment = document.createDocumentFragment();
  for (const entry of distinct.values()) {
    const [x,y] = position(entry);
    if (used.length >= 7) break;
    if (used.some(([px,py]) => Math.hypot((px-x) * viewport.clientWidth/width, (py-y) * viewport.clientHeight/height) < 36)) continue;
    used.push([x,y]);
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "marker";
    marker.style.left = 100 * x / width + "%";
    marker.style.top = 100 * y / height + "%";
    marker.dataset.share = entry.share;
    marker.classList.toggle("selected", entry.share === (state.mine?.share || state.incoming?.share));
    marker.setAttribute("aria-label", "Read note from " + noteName(entry));
    const heart = document.createElement("span");
    heart.textContent = "💙";
    heart.className = "heart";
    heart.setAttribute("aria-hidden", "true");
    marker.append(heart);
    marker.addEventListener("pointerenter", event => {
      if (event.pointerType !== "touch" && !pinned) showTip(entry, false);
    });
    marker.addEventListener("pointerleave", () => { if (!pinned) hideTip(); });
    marker.addEventListener("focus", () => { if (!suppressFocus && !pinned) showTip(entry, false); });
    marker.addEventListener("blur", () => { if (!pinned) hideTip(); });
    marker.addEventListener("click", () => {
      if (pinned && tipEntry?.share === entry.share) hideTip();
      else choose(entry);
    });
    fragment.append(marker);
  }
  const focused = document.activeElement;
  const restore = current.contains(focused) ? focused.dataset.share : "";
  current.replaceChildren(fragment);
  if (restore) {
    suppressFocus = true;
    Array.from(current.children).find(marker => marker.dataset.share === restore)?.focus();
    suppressFocus = false;
  }
}
function renderNoteList(target, notes) {
  const rows = notes.map(note => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "note-row";
    const icon = document.createElement("span");
    icon.className = "note-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "💙";
    const lines = document.createElement("span");
    const name = document.createElement("span");
    name.className = "note-name";
    name.textContent = noteName(note) + (note.handle ? " · Unverified" : "");
    const message = document.createElement("span");
    message.className = "note-copy";
    message.textContent = note.message;
    lines.append(name, message);
    row.append(icon, lines);
    row.addEventListener("click", () => {
      if ($("notes-dialog").open) $("notes-dialog").close();
      choose(note, true);
    });
    return row;
  });
  target.replaceChildren(...rows);
}
function setZoom(next) {
  zoom = Math.min(1.75, Math.max(1, next));
  camera.style.transform = "scale(" + zoom + ")";
  $("zoom-out").disabled = zoom === 1;
  $("zoom-in").disabled = zoom === 1.75;
  if (tipEntry) showTip(tipEntry, pinned);
}
function drawState() {
  const amount = state.count;
  const ended = ready && campaignEnded();
  const lit = Math.min(amount, capacity);
  const percent = lit / capacity * 100;
  $("power").textContent = ready ? number.format(amount) : "—";
  $("progress-text").textContent = ready ? `${number.format(lit)} / ${number.format(capacity)}` : "—";
  $("progress").setAttribute("aria-valuemax", String(capacity));
  $("progress").setAttribute("aria-valuenow", String(lit));
  $("progress").setAttribute("aria-valuetext", `${number.format(lit)} of ${number.format(capacity)} pixels lit`);
  $("progress").firstElementChild.style.width = percent + "%";
  $("light-label").textContent = ended ? "Campaign ended" : state.mine ? "Find my pixel" : "Light up a pixel";
  $("light").classList.toggle("joined", ended || Boolean(state.mine));
  $("light").disabled = busy || !ready;
  $("member-actions").hidden = !state.mine;
  $("note-open").textContent = state.mine?.message ? "Edit my note" : "Leave a note";
  $("stats-hint").textContent = !ready ? "Connecting to the shared map…" : ended ? campaignEndedMessage : state.mine
    ? (isFile ? "Your pixel is saved in this browser." : `Your link brought in ${number.format(state.relays)} ${state.relays === 1 ? "relay" : "relays"}.`)
    : state.incoming ? "A friend sent you a blue heart." : "One pixel per browser.";
  $("notes-open").hidden = state.notes.length === 0;
  $("notes-empty").hidden = !ready || state.notes.length > 0;
  $("notes-empty").textContent = ended ? "No map notes yet." : "Light up a pixel to leave the first note.";
  $("map-notes-hint").hidden = !state.notes.length && !state.incoming?.message;
  renderNoteList($("latest"), state.notes.slice(0, 3));
  if ($("notes-dialog").open) renderNoteList($("all-notes"), state.notes);
  renderMarkers();
  paint();
}
function toast(message) {
  const el = $("toast");
  clearTimeout(toastTimer);
  el.textContent = message;
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, 3900);
}
function fly(target) {
  if (motion.matches) return Promise.resolve();
  const from = $("light").getBoundingClientRect();
  const frame = viewport.getBoundingClientRect();
  const [x,y] = markerAnchor(target);
  const particle = document.createElement("span");
  particle.className = "flight";
  particle.textContent = "💪💙";
  particle.style.left = from.left + from.width / 2 - 23 + "px";
  particle.style.top = from.top + 10 + "px";
  document.body.append(particle);
  const dx = frame.left + x - from.left - from.width / 2;
  const dy = frame.top + y - from.top - 22;
  const animation = particle.animate([
    { transform:"translate(0,0) scale(.86)", opacity:1 },
    { transform:"translate(" + dx * .55 + "px," + (dy * .58 - 27) + "px) scale(1.02)", opacity:1, offset:.58 },
    { transform:"translate(" + dx + "px," + dy + "px) scale(.27)", opacity:.17 }
  ], { duration:520, easing:"cubic-bezier(.32,.1,.28,1)" });
  return animation.finished.catch(() => {}).finally(() => particle.remove());
}

function localData(action, input) {
  let mine;
  try { mine = JSON.parse(localStorage.getItem(memoryKey) || "null"); }
  catch { throw new Error("Local storage is unavailable. Open the online map to light up a pixel."); }
  if (action === "light" && !mine) {
    mine = { position:1, share:"offline", message:null, handle:null, uid:null };
  } else if (action === "note" && mine) {
    mine = { ...mine, message:input.message, handle:input.handle, uid:input.uid || null };
  } else if (action === "remove-note" && mine) {
    mine = { ...mine, message:null, handle:null, uid:null };
  }
  if (action) {
    try { localStorage.setItem(memoryKey, JSON.stringify(mine)); }
    catch { throw new Error("This browser could not save your changes."); }
  }
  const notes = mine?.message
    ? [{ position:mine.position, share:mine.share, message:mine.message, handle:mine.handle }]
    : [];
  return { count:mine ? 1 : 0, mine, incoming:null, relays:0, notes };
}
let arrival = "pending";
async function trackArrival() {
  if (isFile || document.hidden || arrival !== "pending") return;
  arrival = "sending";
  try {
    const response = await fetch("/api/relay", {
      method:"POST", headers:{"Content-Type":"application/json"}, keepalive:true,
      body:JSON.stringify({ action:"visit", ref, source }),
    });
    arrival = response.ok ? "sent" : "pending";
  } catch {
    arrival = "pending";
  }
}

async function request(action, input = {}) {
  if (isFile) return localData(action, input);
  const url = "/api/relay" + (validRef.test(ref) ? "?ref=" + encodeURIComponent(ref) : "");
  const options = action ? {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ action, ref, source, ...input }),
  } : {};
  const response = await fetch(url, { ...options, cache:"no-store" });
  const data = await response.json().catch(() => ({}));
  const ended = action === "light" && response.status === 409 && data.code === "campaign_ended";
  if ((!response.ok && !ended) || typeof data.count !== "number") throw new Error(data.error || "Could not connect to the shared map. Please try again.");
  return data;
}

function apply(data) {
  state = data;
  if (selected) {
    selected = [state.mine, state.incoming, ...state.notes].find(entry => entry?.share === selected.share) ?? selected;
  }
  drawState();
}
let firstLoad = true;
async function refresh() {
  if (busy || document.hidden) return;
  const before = mutation;
  try {
    const data = await request();
    if (busy || mutation !== before) return;
    void trackArrival();
    if (!ready || JSON.stringify(data) !== JSON.stringify(state)) {
      ready = true;
      apply(data);
      if (pinned && tipEntry) {
        const refreshed = [state.mine, state.incoming, ...state.notes].find(entry => entry?.share === tipEntry.share);
        if (refreshed) showTip(refreshed, true);
        else hideTip();
      }
    }
    if (firstLoad && data.incoming && !data.mine) choose(data.incoming);
    if (firstLoad && validRef.test(ref) && !data.incoming) toast(campaignEnded()
      ? "That pixel link is no longer available."
      : "That pixel link is no longer available. You can still light up your own pixel.");
    firstLoad = false;
  } catch (error) {
    if (!ready) $("stats-hint").textContent = error.message;
  }
}
async function light() {
  if (!ready || busy) return;
  if (campaignEnded()) return toast(campaignEndedMessage);
  if (state.mine) return choose(state.mine, true);
  mutation++;
  busy = true;
  $("light").disabled = true;
  $("light-label").textContent = "Lighting up…";
  try {
    const { code, error, ...data } = await request("light");
    if (code === "campaign_ended") {
      apply(data);
      return toast(error || campaignEndedMessage);
    }
    if (!data.mine) throw new Error("Could not confirm your pixel. Please try again.");
    hideTip();
    setZoom(1);
    if (viewport.getBoundingClientRect().bottom < 0) viewport.scrollIntoView({ block:"nearest" });
    await fly(data.mine);
    selected = data.mine;
    apply(data);
    toast("Your pixel is lit · +1 Power");
  } catch (error) { toast(error.message); }
  finally {
    busy = false;
    drawState();
  }
}
function openNote() {
  $("note-input").value = state.mine.message || "";
  $("handle-input").value = state.mine.handle ? "@" + state.mine.handle : "";
  $("uid-input").value = state.mine.uid || "";
  $("handle-consent-row").hidden = !state.mine.handle;
  $("handle-consent").checked = Boolean(state.mine.handle);
  $("remove-note").hidden = !state.mine.message;
  $("note-error").hidden = true;
  $("note-dialog").showModal();
}
function noteError(message) {
  $("note-error").textContent = message;
  $("note-error").hidden = false;
}
async function editNote(remove) {
  if (busy) return;
  const message = $("note-input").value.trim();
  const handle = $("handle-input").value.trim().replace(/^@/, "");
  const uid = $("uid-input").value.trim();
  const consent = $("handle-consent").checked;
  if (!remove && (!message || [...message].length > 80 || /[\r\n]/.test(message))) return noteError("Write one line of up to 80 characters.");
  if (!remove && handle && (!/^[A-Za-z0-9_]{1,15}$/.test(handle) || !consent)) return noteError("Enter a valid X handle and check the consent box, or leave the handle blank to post anonymously.");
  if (!remove && uid && !validUid.test(uid)) return noteError("Enter a MEXC UID using digits only, or leave it blank.");
  mutation++;
  busy = true;
  $("save-note").disabled = true;
  $("remove-note").disabled = true;
  try {
    const data = await request(remove ? "remove-note" : "note", { message, handle, consent, uid });
    hideTip();
    apply(data);
    $("note-dialog").close();
    choose(data.mine, true, !remove);
    toast(remove ? "Note removed. Your pixel is still lit." : "Your note is now on the map.");
  } catch (error) { noteError(error.message); }
  finally {
    busy = false;
    $("save-note").disabled = false;
    $("remove-note").disabled = false;
    $("light").disabled = !ready;
  }
}
function share(personal) {
  const ended = campaignEnded();
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  if (personal && !isFile) url.searchParams.set("ref", state.mine.share);
  currentUrl = isFile ? "" : url.href;
  $("share-title").textContent = personal ? "Share my pixel" : "Share the activity";
  $("share-help").textContent = isFile
    ? "Your pixel and note are saved on this device. You can copy the message or the 💪💙 emoji."
    : personal ? "Share this link so a friend can find your pixel." : ended
      ? "Share this link so a friend can see the completed map."
      : "Share this link so a friend can light up a pixel on the same map.";
  const line = ended
    ? personal ? "I lit this pixel on the MEXC map. See what we made together! 💪💙" : "We lit up the MEXC map together! 💪💙"
    : personal ? "I lit this pixel on the MEXC map. Add yours and pass it on! 💪💙" : "Light up the MEXC map and pass the blue heart on! 💪💙";
  $("share-text").value = line + (currentUrl ? "\n" + currentUrl : "");
  $("copy-link").hidden = !currentUrl;
  $("share-dialog").showModal();
}
async function copy(value, message) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const temp = document.createElement("textarea");
    temp.value = value;
    temp.style.position = "fixed";
    temp.style.opacity = "0";
    $("share-dialog").append(temp);
    temp.select();
    const success = document.execCommand("copy");
    temp.remove();
    if (!success) {
      $("share-text").focus();
      $("share-text").select();
      return toast("The message is selected. You can copy it manually.");
    }
  }
  toast(message);
}
function wire() {
  $("light").addEventListener("click", light);
  $("help-open").addEventListener("click", () => $("help-dialog").showModal());
  $("note-open").addEventListener("click", openNote);
  $("note-form").addEventListener("submit", e => { e.preventDefault(); editNote(false); });
  $("remove-note").addEventListener("click", () => editNote(true));
  $("handle-input").addEventListener("input", () => {
    $("handle-consent-row").hidden = !$("handle-input").value.trim();
    if ($("handle-consent-row").hidden) $("handle-consent").checked = false;
  });
  $("share-open").addEventListener("click", () => share(false));
  $("share-pixel").addEventListener("click", () => share(true));
  $("copy-share").addEventListener("click", () => copy($("share-text").value, "Message copied."));
  $("copy-link").addEventListener("click", () => copy(currentUrl, "Link copied."));
  $("copy-emoji").addEventListener("click", () => copy("💪💙", "💪💙 copied."));
  $("notes-open").addEventListener("click", () => {
    renderNoteList($("all-notes"), state.notes);
    $("notes-dialog").showModal();
  });
  $("zoom-in").addEventListener("click", () => setZoom(zoom + .25));
  $("zoom-out").addEventListener("click", () => setZoom(zoom - .25));
  $("zoom-reset").addEventListener("click", () => { setZoom(1); hideTip(); selected = null; paint(); });
  viewport.addEventListener("click", event => { if (event.target === canvas) hideTip(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !document.querySelector("dialog[open]")) hideTip(); });
  document.querySelectorAll("[data-close]").forEach(button => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  if (isFile) {
    $("footer-note").hidden = false;
    $("note-disclosure").textContent = "Your note is saved in this browser. Adding an X handle is optional.";
    $("uid-hint").textContent = "Saved in this browser.";
  }
}

paintLand();
wire();
setZoom(1);
drawState();
new ResizeObserver(() => {
  paint();
  renderMarkers();
  if (tipEntry) showTip(tipEntry, pinned);
}).observe(viewport);
refresh();
if (!isFile) setInterval(refresh, 9000);
document.addEventListener("visibilitychange", refresh);
