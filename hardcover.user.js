// ==UserScript==
// @name         Hardcover Librarian Tampermonkey
// @namespace    https://github.com/kyle-mckay/hardcover-librarian-tampermonkey
// @updateURL    https://raw.githubusercontent.com/kyle-mckay/hardcover-librarian-tampermonkey/main/hardcover.user.js
// @downloadURL  https://raw.githubusercontent.com/kyle-mckay/hardcover-librarian-tampermonkey/main/hardcover.user.js
// @author       kyle-mckay
// @version      1.2.2
// @description  Extract book metadata from supported sites like Goodreads and optionally inject into sites like Hardcovers.app for easier book creation.
// @match        https://www.goodreads.com/*
// @match        https://hardcover.app/*
// @match        https://audible.ca/*
// @include /^https:\/\/(www\.)?amazon\.[a-z.]+\/dp\/[A-Z0-9]{10}(?:[/?].*)?$/
// @include /^https:\/\/(www\.)?amazon\.[a-z.]+\/[^\/]+\/dp\/[A-Z0-9]{10}(?:[/?].*)?$/
// @icon         https://assets.hardcover.app/static/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==

// ===== SECTION: Utilities and Functions =====
// ===== FILE PATH: src/modules/utilities.js ==========

/**
 * Logging utility with configurable verbosity levels and named loggers.
 *
 * LogLevel enum defines severity levels: ERROR (0), WARN (1), INFO (2), DEBUG (3).
 * currentLogLevel controls the global log output verbosity.
 * bubbleRefresh sets refresh interval for UI bubbles (not related to logging).
 *
 * createLogger(fnName): Returns a logger object scoped to the given function/module name.
 * Each logger method prepends the fnName to the message for clear context.
 *
 * log(level, ...args): Internal function routing logs to console based on level and currentLogLevel.
 */

const LogLevel = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

let currentLogLevel = LogLevel.DEBUG; // Change this to control global verbosity
let bubbleRefresh = 2000; // The number of miliseconds the bubble refreshes the URL. Allows buttons to show/hide dynamically during normal navigation.

function createLogger(fnName) {
  return {
    error: (msg, ...args) => log(LogLevel.ERROR, `[${fnName}] ${msg}`, ...args),
    warn: (msg, ...args) => log(LogLevel.WARN, `[${fnName}] ${msg}`, ...args),
    info: (msg, ...args) => log(LogLevel.INFO, `[${fnName}] ${msg}`, ...args),
    debug: (msg, ...args) => log(LogLevel.DEBUG, `[${fnName}] ${msg}`, ...args),
  };
}

function log(level, ...args) {
  if (level <= currentLogLevel) {
    switch (level) {
      case LogLevel.ERROR:
        console.error("[ERROR]", ...args);
        break;
      case LogLevel.WARN:
        console.warn("[WARN]", ...args);
        break;
      case LogLevel.INFO:
        console.info("[ℹINFO]", ...args);
        break;
      case LogLevel.DEBUG:
        console.debug("[DEBUG]", ...args);
        break;
    }
  }
}

/**
 * Schema definition object representing the structure of extracted book metadata.
 * Fields include identifiers, descriptive info, contributors, publication details, and more.
 * This serves as the standardized data container for book extraction results.
 */
const bookSchema = {
  sourceId: "", // The source ID from the extracted site (Goodreads, Amazon, Google Books, etc.)
  title: "",
  subtitle: "",
  urlSlug: "",
  headline: "", // Description headline field
  literaryType: "", // Fiction, Non-Fiction or 'Unknown or Not Applicable'
  bookCategory: "", // Book, Novella, Short Story, Graphic Novel, Fan Fiction, Research Paper, Poetry, Collection, Web Novel, Light Novel
  compilation: false, // If it is a compilation of other books
  seriesName: "",
  seriesNumber: "",
  isbn10: "",
  isbn13: "",
  asin: "",
  cover: "", // Image URL
  authors: [], // Array of authors
  contributors: [], // Array of contributors and their role
  publisher: "",
  readingFormat: "", // Physical Book, Audiobook, E-Book
  pageCount: null,
  audiobookDuration: [], // Hours, Minutes, Seconds
  editionFormat: "", // Hardcover, Paperback, Kindle
  editionInfo: "", // Reprint, Large Print, etc.
  releaseDate: "",
  releaseLanguage: "",
  releaseCountry: "",
  description: "", // Multi text book description
};

/**
 * Saves the given book data object to persistent storage using GM_setValue.
 * Logs each step including warnings when no data is provided and errors during serialization or saving.
 * @param {Object} data - Book data to be saved.
 */
function saveBookData(data) {
  const logger = createLogger("saveBookData");

  if (!data) {
    logger.warn("No data provided to save.");
    return;
  }

  try {
    const jsonData = JSON.stringify(data);
    logger.debug("Serialized data:", jsonData);
    GM_setValue("bookData", jsonData);
    logger.info("Book data saved successfully.");
  } catch (error) {
    logger.error("Failed to save book data:", error);
  }
}

/**
 * Loads book data from persistent storage using GM_getValue.
 * Returns a parsed object or an empty object on failure.
 * Logs the raw data retrieved and any errors encountered during parsing.
 * @returns {Object} Parsed book data object.
 */
function loadBookData() {
  const logger = createLogger("loadBookData");
  try {
    const rawData = GM_getValue("bookData", "{}");
    logger.debug("Raw stored data:", rawData);
    const bookData = JSON.parse(rawData);
    logger.info("Book data loaded successfully.");
    return bookData;
  } catch (error) {
    logger.error("Failed to load or parse book data:", error);
    return {}; // Return empty object on failure to avoid breaking code
  }
}

/**
 * Converts an HTML element's content to plain text while preserving line breaks.
 * Replaces <br> tags with newline characters and wraps <p> elements with newlines.
 * Clones the element to avoid modifying the original DOM.
 * @param {HTMLElement} htmlElement - The source HTML element.
 * @returns {string} Text content with line breaks preserved.
 */
function htmlToTextWithLineBreaks(htmlElement) {
  if (!htmlElement) return "";

  // Clone the element so we don't modify the original DOM
  const clone = htmlElement.cloneNode(true);

  // Replace <br> with newline characters
  clone.querySelectorAll("br").forEach((br) => {
    br.replaceWith("\n");
  });

  // Replace <p> with newlines before and after
  clone.querySelectorAll("p").forEach((p) => {
    const text = p.textContent.trim();
    const textWithBreaks = "\n" + text + "\n";
    p.replaceWith(textWithBreaks);
  });

  // Get the cleaned text
  return clone.textContent.trim();
}

/**
 * Site-specific modules for detecting and extracting book data.
 * Each module provides:
 * - detect(): returns boolean if the current page matches the site structure.
 * - extract(): calls site-specific extraction function and returns extracted data.
 *
 * Uses createLogger for debug tracing of detection and extraction processes.
 */
const siteModules = {
  "goodreads.com": {
    detect() {
      const logger = createLogger("siteModules.goodreads.detect");
      logger.debug("Running detection on www.goodreads.com");

      const found =
        document.querySelector('h1[data-testid="bookTitle"]') !== null;
      logger.debug(`Detection result: ${found}`);

      return found;
    },
    extract() {
      const logger = createLogger("siteModules.goodreads.extract");
      logger.debug("Calling extractGoodreads()");

      const result = extractGoodreads();
      logger.debug("extractGoodreads() returned:", result);

      return result;
    },
  },
  amazon: {
    detect() {
      const logger = createLogger("siteModules.amazon.detect");
      logger.debug("Running detection on amazon");

      const found = Boolean(document.querySelector("#productTitle"));
      logger.debug(`Detection result: ${found}`);

      return found;
    },
    extract() {
      const logger = createLogger("siteModules.amazon.extract");
      logger.debug("Calling extractAmazon()");

      const result = extractAmazon();
      logger.debug("extractAmazon() returned:", result);

      return result;
    },
  },
  // add other site modules here
};

// ===== SECTION: User Interface Components =====
// ===== FILE PATH: src/modules/ui.js ==========

/**
 * UI component function to add a floating preview panel ("bubble") to the page.
 *
 * This panel displays stored book metadata in a JSON formatted view on the left,
 * and shows the book cover image with a clickable link and download option on the right.
 *
 * Key behaviors:
 * - Loads book data from persistent storage.
 * - Skips rendering if no valid data or panel already exists.
 * - Creates a fixed-position panel anchored to bottom-left of viewport.
 * - Includes a close button to remove the panel.
 * - Uses monospace font and styled containers for readability.
 * - Excludes the cover URL from JSON preview to reduce clutter.
 * - The cover image opens in a new tab when clicked.
 * - A download link below the cover triggers a save of the image.
 * - All style and DOM creation is done programmatically.
 * - Uses logging to track loading, error, and lifecycle events.
 */
function addPreviewPanel() {
  const logger = createLogger("addPreviewPanel");

  let data;
  try {
    data = loadBookData();
  } catch (err) {
    logger.error("Failed to load book data:", err);
    return;
  }

  if (!data || Object.keys(data).length === 0 || !data.title) {
    logger.warn("No valid book data to display:", data);
    return;
  }

  if (document.getElementById("bookPreviewPanel")) {
    logger.debug("Preview panel already exists.");
    return;
  }

  const panel = document.createElement("div");
  panel.id = "bookPreviewPanel";
  Object.assign(panel.style, {
    position: "fixed",
    bottom: "10px",
    left: "10px",
    width: "600px",
    maxHeight: "400px",
    background: "#fdfdfd",
    border: "1px solid #888",
    borderRadius: "8px",
    boxShadow: "0 4px 10px rgba(0, 0, 0, 0.2)",
    padding: "12px",
    fontFamily: "monospace",
    fontSize: "11px",
    overflowY: "auto",
    zIndex: 99999,
    display: "flex",
    gap: "12px",
  });

  const closeBtn = document.createElement("button");
  closeBtn.innerText = "✖";
  Object.assign(closeBtn.style, {
    position: "absolute",
    top: "8px",
    right: "8px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: "14px",
  });
  closeBtn.title = "Close";
  closeBtn.onclick = () => {
    logger.debug("Preview panel closed.");
    panel.remove();
  };

  // Left pane: JSON preview excluding cover image
  const jsonPreview = document.createElement("pre");
  Object.assign(jsonPreview.style, {
    flex: "1",
    background: "#eee",
    padding: "6px",
    borderRadius: "6px",
    maxHeight: "380px",
    overflowY: "auto",
    whiteSpace: "pre-wrap",
  });
  const dataClone = { ...data };
  delete dataClone.cover; // exclude cover URL from JSON preview
  jsonPreview.textContent = JSON.stringify(dataClone, null, 2);

  // Right pane: cover image + download link
  const rightPane = document.createElement("div");
  Object.assign(rightPane.style, {
    width: "150px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
  });

  if (data.cover) {
    const link = document.createElement("a");
    link.href = data.cover;
    link.target = "_blank";
    link.title = "Open cover image in new tab";
    link.style.display = "block";
    link.style.width = "100%";

    const img = document.createElement("img");
    img.src = data.cover;
    img.alt = data.title || "Cover Image";
    img.style.width = "100%";
    img.style.borderRadius = "6px";
    img.style.cursor = "pointer";

    link.appendChild(img);
    rightPane.appendChild(link);

    const downloadLink = document.createElement("a");
    downloadLink.href = data.cover;
    downloadLink.download = ""; // filename from URL
    downloadLink.textContent = "⬇️ Download Cover";
    Object.assign(downloadLink.style, {
      color: "#0055aa",
      textDecoration: "underline",
      cursor: "pointer",
      fontSize: "12px",
      userSelect: "none",
    });

    rightPane.appendChild(downloadLink);
  }

  panel.appendChild(closeBtn);
  panel.appendChild(jsonPreview);
  panel.appendChild(rightPane);
  document.body.appendChild(panel);
  logger.debug("Preview panel injected.");
}

/**
 * Creates the floating bubble UI container with header and content.
 * Returns references for bubble, content container, and header.
 * Styling is centralized here for easier future theme toggling.
 */
function createFloatingBubbleUI(logger, onToggle) {
  const bubble = document.createElement("div");
  bubble.id = "floatingBubble";
  Object.assign(bubble.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    width: "600px", // expanded width
    background: "#fff",
    border: "1px solid #888",
    borderRadius: "10px",
    boxShadow: "0 4px 10px rgba(0,0,0,0.2)",
    zIndex: 99999,
    fontFamily: "sans-serif",
    fontSize: "14px",
    color: "#222",
    userSelect: "none",
    overflow: "hidden",
    transition: "height 0.3s ease, width 0.3s ease, visibility 0.3s ease",
    height: "auto", // start expanded
  });

  const header = document.createElement("div");
  header.style.cssText = `
    background: #0055aa;
    color: #fff;
    padding: 8px;
    cursor: pointer;
    font-weight: bold;
    user-select: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;
  header.textContent = "Book Metadata";

  const toggleIcon = document.createElement("span");
  toggleIcon.textContent = "▼";
  toggleIcon.style.transition = "transform 0.3s ease";
  header.appendChild(toggleIcon);

  const content = document.createElement("div");
  content.id = "floatingBubbleContent";
  Object.assign(content.style, {
    padding: "8px",
    display: "flex",
    flexDirection: "column",
    maxHeight: "350px",
    overflowY: "auto",
    visibility: "visible", // start visible
    height: "auto",
    transition: "height 0.3s ease, visibility 0.3s ease",
  });

  const btnContainer = document.createElement("div");
  btnContainer.style.display = "flex";
  btnContainer.style.flexWrap = "nowrap";
  btnContainer.style.gap = "8px";
  btnContainer.style.marginBottom = "8px";

  header.onclick = () => {
    if (content.style.visibility === "hidden") {
      // Expand
      content.style.visibility = "visible";
      content.style.height = "auto";
      bubble.style.width = "600px"; // expanded width
      toggleIcon.style.transform = "rotate(0deg)"; // arrow up
      logger.debug("Bubble expanded");
    } else {
      // Collapse
      content.style.height = "0";
      content.style.visibility = "hidden";
      bubble.style.width = "200px"; // collapsed width
      toggleIcon.style.transform = "rotate(180deg)"; // arrow down
      logger.debug("Bubble collapsed");
    }
  };

  bubble.appendChild(header);
  bubble.appendChild(content);
  document.body.appendChild(bubble);

  return { bubble, content, header };
}

/**
 * Creates a message element used to display temporary messages in the UI.
 * The message element is styled for visibility and fade transitions.
 */
function createFloatingMessage() {
  const msg = document.createElement("div");
  msg.id = "floatingBubbleMessage";
  Object.assign(msg.style, {
    marginBottom: "8px",
    color: "#007700",
    fontWeight: "bold",
    minHeight: "18px",
    transition: "opacity 0.3s ease",
    opacity: "0",
    userSelect: "none",
  });
  return msg;
}

/**
 * Shows a temporary message inside the provided element for a duration.
 * Fades out message smoothly and clears text after timeout.
 * @param {HTMLElement} el Element to display message in
 * @param {string} msg Message text to show
 * @param {number} duration Duration in ms to show message
 */
function showMessage(el, msg, duration = 3000) {
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(showMessage.timeoutId);
  showMessage.timeoutId = setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => {
      el.textContent = "";
    }, 300);
  }, duration);
}

/**
 * Creates the detailed book metadata display area inside the bubble.
 * Shows key-value pairs on left and cover image + download on right.
 * Click on a value copies it to clipboard with logging and message.
 * @param {object} data Book metadata object to display
 * @param {object} logger Logger for informational messages
 * @param {function} showMessageFn Function to display messages
 * @returns {HTMLElement} Container div holding the entire display
 */
function createBookDisplay(data, logger, showMessageFn) {
  const container = document.createElement("div");
  container.className = "floatingBubbleFlexContainer";
  Object.assign(container.style, {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    maxHeight: "250px",
    overflow: "hidden",
  });

  const prettify = (str) =>
    str
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (c) => c.toUpperCase())
      .trim();

  // Left pane with formatted text
  const left = document.createElement("div");
  Object.assign(left.style, {
    flex: "1",
    background: "#eee",
    padding: "6px",
    borderRadius: "6px",
    maxHeight: "250px",
    overflowY: "auto",
    fontFamily: "monospace",
    fontSize: "12px",
    userSelect: "none",
  });

  Object.entries(data).forEach(([key, value]) => {
    if (!value) return;

    if (key === "audiobookDuration" && Array.isArray(value) && value.length) {
      const dur = value[0];
      const parts = [];
      if (dur.hours)
        parts.push(`${dur.hours} hour${dur.hours !== 1 ? "s" : ""}`);
      if (dur.minutes)
        parts.push(`${dur.minutes} minute${dur.minutes !== 1 ? "s" : ""}`);
      if (dur.seconds)
        parts.push(`${dur.seconds} second${dur.seconds !== 1 ? "s" : ""}`);
      value = parts.join(", ");
    } else if (Array.isArray(value)) {
      value =
        key === "contributors"
          ? value.map((c) => `${c.name} (${c.role})`).join(", ")
          : value.join(", ");
    }

    const div = document.createElement("div");
    div.style.marginBottom = "4px";

    const label = document.createElement("span");
    label.textContent = `${prettify(key)}: `;
    label.style.fontWeight = "bold";

    const val = document.createElement("span");
    val.textContent = value;
    val.style.cursor = "pointer";
    val.style.color = "#0055aa";
    val.style.textDecoration = "underline";
    val.title = "Click to copy";
    val.onclick = () => {
      navigator.clipboard.writeText(value).then(() => {
        logger.info(`Copied "${key}" to clipboard.`);
        showMessageFn(`Copied ${prettify(key)} to clipboard`);
      });
    };

    div.appendChild(label);
    div.appendChild(val);
    left.appendChild(div);
  });

  container.appendChild(left);

  // Right pane with cover image + download link
  if (data.cover) {
    const right = document.createElement("div");
    right.id = "imgContainer";
    Object.assign(right.style, {
      width: "150px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "6px",
      overflow: "hidden",
    });

    const link = document.createElement("a");
    link.href = data.cover;
    link.target = "_blank";
    link.title = "Open cover image in new tab";
    link.style.display = "block";
    link.style.width = "100%";

    const img = document.createElement("img");
    img.src = data.cover;
    img.alt = data.title || "Cover Image";
    Object.assign(img.style, {
      width: "100%",
      borderRadius: "6px",
      cursor: "pointer",
      userSelect: "none",
    });

    link.appendChild(img);
    right.appendChild(link);

    const downloadLink = document.createElement("a");
    downloadLink.href = "#";
    downloadLink.textContent = "⬇️ Download Cover";
    Object.assign(downloadLink.style, {
      color: "#0055aa",
      textDecoration: "underline",
      cursor: "pointer",
      fontSize: "12px",
      userSelect: "none",
    });

    downloadLink.onclick = async (e) => {
      e.preventDefault();
      try {
        const response = await fetch(data.cover, { mode: "cors" });
        if (!response.ok) throw new Error("Network response was not ok");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;

        const filename =
          data.cover.split("/").pop().split("?")[0] || "cover.jpg";
        a.download = filename;

        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert("Failed to download image.");
        logger.error("Image download failed:", err);
      }
    };

    right.appendChild(downloadLink);
    container.appendChild(right);
  }

  return container;
}

/**
 * Creates a styled button element.
 * @param {string} label Button text label
 * @param {function} onClick Click event handler
 * @param {object} styles Optional CSS styles as an object
 * @returns {HTMLButtonElement}
 */
function createButton(label, onClick, styles = {}) {
  const btn = document.createElement("button");
  btn.textContent = label;
  Object.assign(btn.style, {
    padding: "6px 10px",
    fontSize: "14px",
    borderRadius: "4px",
    border: "1px solid #0077cc",
    backgroundColor: "#0077cc",
    color: "#fff",
    cursor: "pointer",
    userSelect: "none",
    transition: "background-color 0.3s ease",
    ...styles,
  });

  btn.onmouseenter = () => {
    btn.style.backgroundColor = "#005fa3";
  };
  btn.onmouseleave = () => {
    btn.style.backgroundColor = "#0077cc";
  };
  btn.onclick = onClick;

  if (styles.disabled) {
    btn.disabled = true;
    btn.style.opacity = "0.6";
    btn.style.cursor = "not-allowed";
  }

  return btn;
}

// Export UI component functions for external usage
const UIComponents = {
  addPreviewPanel,
  createFloatingBubbleUI,
  createFloatingMessage,
  showMessage,
  createBookDisplay,
  createButton,
};

// ===== SECTION: Amazon Extraction =====
// ===== FILE PATH: src/extractors/amazon.js ==========

/**
 * Extracts book metadata from an Amazon book product page.
 *
 * This async function scrapes key information such as:
 * - Title, subtitle, reading format, edition info, release date
 * - Description text with line breaks preserved
 * - Cover image URL
 * - Authors, contributors, and publisher info from byline
 * - Detailed product info depending on format (audiobook or regular book)
 *
 * Utilizes DOM queries to target Amazon's page structure, with fallback and normalization logic.
 * Logs detailed debug info at every step for traceability.
 * Returns a populated bookSchema object with extracted data.
 */
async function extractAmazon() {
  const logger = createLogger("extractAmazon");
  logger.debug("Invoked extractAmazon()");

  const data = bookSchema;

  // --- Basic title, subtitle, reading format, edition info ---
  const titleEl = document.querySelector("#productTitle");
  const subtitleEl = document.querySelector("#productSubtitle");
  const bindingEl = document.querySelector("#productBinding");
  const versionEl = document.querySelector("#productVersion");

  if (titleEl) {
    data.title = titleEl.textContent.trim();
    logger.debug(`Title extracted: ${data.title}`);
  } else {
    logger.debug("Title element not found");
  }

  if (subtitleEl) {
    const subtitleText = subtitleEl.textContent.trim();
    logger.debug(`Subtitle extracted: ${subtitleText}`);

    const parts = subtitleText.split("–").map((part) => part.trim());

    if (parts.length === 2) {
      // Normalize readingFormat here
      const rawFormat = parts[0].toLowerCase();

      if (rawFormat.includes("kindle") || rawFormat.includes("ebook")) {
        data.readingFormat = "E-Book";
        data.editionInfo = parts[0]; // preserve original format info
      } else if (
        rawFormat.includes("hardcover") ||
        rawFormat.includes("paperback") ||
        rawFormat.includes("mass market") ||
        rawFormat.includes("large print")
      ) {
        data.readingFormat = "Physical Book";
        data.editionInfo = parts[0]; // move format description here
      } else if (rawFormat.includes("audiobook")) {
        data.readingFormat = "Audiobook";
        data.editionFormat = "Audible"; // default for audiobook
        data.editionInfo = ""; // no editionInfo here for now
      } else {
        // Fallback: just store original
        data.readingFormat = parts[0];
        data.editionInfo = "";
      }

      data.releaseDate = parts[1];
      logger.debug(`Reading format: ${data.readingFormat}`);
      logger.debug(`Edition info: ${data.editionInfo}`);
      logger.debug(`Release date: ${data.releaseDate}`);
    } else {
      logger.debug('Subtitle does not contain expected format with "–"');
    }
  } else if (bindingEl) {
    // Audiobook fallback
    const bindingText = bindingEl.textContent.trim();
    let versionText = versionEl ? versionEl.textContent.trim() : "";
    versionText = versionText.replace(/^–+\s*/, "");

    data.readingFormat = "Audiobook";
    data.editionFormat = "Audible";
    data.editionInfo = versionText || "";

    logger.debug(`Reading format set to: ${data.readingFormat}`);
    logger.debug(`Edition format set to: ${data.editionFormat}`);
    logger.debug(`Edition info set to: ${data.editionInfo}`);

    data.releaseDate = "";
  } else {
    logger.debug("Subtitle and audiobook elements not found");
  }

  // Extract description

  const descriptionContainer = document.querySelector(
    "#bookDescription_feature_div .a-expander-content"
  );
  if (descriptionContainer) {
    data.description = htmlToTextWithLineBreaks(descriptionContainer);
    logger.debug("Description extracted with line breaks.");
  } else {
    logger.debug("Description element not found.");
  }

  // Extract Cover
  const coverImgEl = document.getElementById("landingImage");
  if (coverImgEl) {
    data.cover = coverImgEl.src || "";
    logger.debug(`Cover image URL extracted: ${data.cover}`);
  } else {
    logger.debug("Cover image element not found");
  }

  // --- Extract authors, contributors, publisher from byline ---
  logger.debug("Extracting authors, contributors, and publisher");

  const bylineSpans = document.querySelectorAll("#bylineInfo .author");
  const authorsSet = new Set();
  const contributors = [];
  let publisherName = "";

  bylineSpans.forEach((span) => {
    const name = span.querySelector("a")?.textContent?.trim();
    const roleRaw = span
      .querySelector(".contribution .a-color-secondary")
      ?.textContent?.trim();
    if (!name || !roleRaw) return;

    // Clean and normalize roles, split by commas or spaces
    const roles = roleRaw
      .replace(/[()]/g, "")
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((r) => r.toLowerCase());

    // Add to authors if any role is 'author'
    if (roles.includes("author")) {
      authorsSet.add(name);
    }

    if (roles.includes("publisher")) {
      publisherName = name;
    } else {
      // For contributors, exclude 'author' role if already an author
      const contributorRoles = roles.filter((r) => r !== "author");

      if (contributorRoles.length > 0) {
        const roleDisplay = contributorRoles
          .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
          .join(" ");
        contributors.push({
          name,
          role: roleDisplay,
        });
      }
    }
  });

  data.authors = Array.from(authorsSet);
  data.contributors = contributors;
  data.publisher = publisherName;

  logger.debug(`Authors parsed: ${JSON.stringify(data.authors)}`);
  logger.debug(`Contributors parsed: ${JSON.stringify(data.contributors)}`);
  logger.debug(`Publisher parsed: ${data.publisher}`);

  // Parse Series

  const seriesWidget = document.querySelector('#seriesBulletWidget_feature_div a');

if (seriesWidget) {
  const text = seriesWidget.textContent.trim(); // "Book 20 of 29: Backyard Starship"

  const match = text.match(/Book\s+(\d+)\s+of\s+\d+:\s+(.+)/i);
  if (match) {
    const seriesNumber = match[1]; // "20"
    const seriesName = match[2];   // "Backyard Starship"

    data.seriesNumber = seriesNumber;
    data.seriesName = seriesName;

    logger.debug(`Series number: ${seriesNumber}`);
    logger.debug(`Series name: ${seriesName}`);
  }
}

  // --- Determine where to parse product details based on readingFormat ---
  const readingFormatLower = (data.readingFormat || "").toLowerCase();

  if (
    readingFormatLower.includes("audiobook") ||
    readingFormatLower === "audiobook"
  ) {
    // Parse Audible product details table
    const audibleDetailsTable = document.querySelector(
      "#audibleProductDetails table.a-keyvalue"
    );

    if (audibleDetailsTable) {
      const rows = audibleDetailsTable.querySelectorAll("tr");
      rows.forEach((row) => {
        const header =
          row.querySelector("th")?.textContent?.trim().toLowerCase() || "";
        const valueEl = row.querySelector("td");
        const valueText = valueEl?.textContent?.trim() || "";

        switch (header) {
          case "part of series":
            data.seriesName = valueText;
            logger.debug(`Series name: ${data.seriesName}`);
            break;

          case "listening length":
            // Parse duration into hours, minutes, seconds
            const durationParts =
              valueText
                .toLowerCase()
                .match(/\d+\s*hours?|\d+\s*minutes?|\d+\s*seconds?/g) || [];
            let durationObj = { hours: 0, minutes: 0, seconds: 0 };
            durationParts.forEach((part) => {
              if (part.includes("hour"))
                durationObj.hours = parseInt(part, 10) || 0;
              else if (part.includes("minute"))
                durationObj.minutes = parseInt(part, 10) || 0;
              else if (part.includes("second"))
                durationObj.seconds = parseInt(part, 10) || 0;
            });
            data.audiobookDuration = [durationObj];
            logger.debug(`Audiobook duration: ${JSON.stringify(durationObj)}`);
            break;

          case "audible.com release date":
            data.releaseDate = valueText;
            logger.debug(`Release date (Audible): ${data.releaseDate}`);
            break;

          case "publisher":
            data.publisher = valueText;
            logger.debug(`Publisher: ${data.publisher}`);
            break;

          case "program type":
            data.readingFormat = valueText;
            logger.debug(
              `Reading format (Program Type): ${data.readingFormat}`
            );
            break;

          case "version":
            data.editionInfo = valueText.replace(/^–+\s*/, "");
            logger.debug(`Edition info: ${data.editionInfo}`);
            break;

          case "language":
            data.releaseLanguage = valueText;
            logger.debug(`Release language: ${data.releaseLanguage}`);
            break;

          case "asin":
            data.asin = valueText;
            logger.debug(`ASIN: ${data.asin}`);
            break;
        }
      });
    } else {
      logger.debug("Audible product details table not found");
    }
  } else {
    // Regular books - parse detail bullets
    const detailBulletsList = document.querySelector(
      "#detailBullets_feature_div ul.detail-bullet-list"
    );

    if (detailBulletsList) {
      const items = detailBulletsList.querySelectorAll("li");
      items.forEach((li) => {
        const labelEl = li.querySelector("span.a-text-bold");
        const valueEl = labelEl ? labelEl.nextElementSibling : null;
        if (!labelEl || !valueEl) return;

        let label = labelEl.textContent || "";
        label = label
          .replace(/[‏:\u200E\u200F]/g, "")
          .trim()
          .toLowerCase();
        const value = valueEl.textContent.trim();

        logger.debug(`Detail bullet label: "${label}", value: "${value}"`);

        switch (label) {
          case "publisher":
            if (!data.publisher) data.publisher = value;
            logger.debug(`Publisher: ${data.publisher}`);
            break;

          case "publication date":
            data.releaseDate = value;
            logger.debug(`Release date: ${data.releaseDate}`);
            break;

          case "language":
            data.releaseLanguage = value;
            logger.debug(`Release language: ${data.releaseLanguage}`);
            break;

          case "print length":
            const pageCountMatch = value.match(/\d+/);
            if (pageCountMatch) {
              data.pageCount = parseInt(pageCountMatch[0], 10);
              logger.debug(`Page count: ${data.pageCount}`);
            }
            break;

          case "isbn-10":
            data.isbn10 = value.replace(/-/g, "");
            logger.debug(`ISBN-10: ${data.isbn10}`);
            break;

          case "isbn-13":
            data.isbn13 = value.replace(/-/g, "");
            logger.debug(`ISBN-13: ${data.isbn13}`);
            break;
        }
      });
    } else {
      logger.debug("Detail bullets list not found");
    }
  }

  logger.debug("Final extracted Amazon data:", data);
  return data;
}

// ===== SECTION: Goodreads Extraction =====
// ===== FILE PATH: src/extractors/goodreads.js ==========

/**
 * Extracts book metadata from a Goodreads book page.
 * 
 * This async function scrapes various details including:
 * - Cover image URL
 * - Title and authors (including expanding "...more" contributors if present)
 * - Description text
 * - Series name and number
 * - Detailed lists of authors and contributors with roles
 * - Edition details like format, publication date, publisher, ISBNs, ASIN, and language
 * 
 * Uses DOM queries targeting Goodreads' page structure, with logic to normalize and parse key fields.
 * Waits briefly to load expanded contributor data if necessary.
 * Logs detailed debug messages to trace extraction steps.
 * Returns a populated bookSchema object with extracted metadata.
 */
async function extractGoodreads() {
  const logger = createLogger("extractGoodreads");
  logger.debug("Invoked extractGoodreads()");

  const data = bookSchema;

  // Expand "...more" contributors if present, to access full contributor list
  const moreContributorsBtn = document.querySelector(
    ".ContributorLinksList .Button__labelItem"
  );
  if (
    moreContributorsBtn &&
    moreContributorsBtn.textContent.trim() === "...more"
  ) {
    moreContributorsBtn.click();
    logger.debug('Clicked "...more" contributor button');

    // Wait 500ms for contributors to load after clicking
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Extract cover image URL
  const coverEl =
    document.querySelector(".BookCover__image img.ResponsiveImage")?.src ||
    null;
  data.cover = coverEl;
  logger.debug("Extracted cover:", coverEl);

  // Extract book title
  const titleEl = document.querySelector('h1[data-testid="bookTitle"]');
  data.title = titleEl?.textContent.trim() || "";
  logger.debug("Extracted title:", data.title);

  // Initial authors extraction from itemprop=name spans
  data.authors = Array.from(
    document.querySelectorAll('span[itemprop="name"]')
  ).map((el) => el.textContent.trim());
  logger.debug("Initial authors extracted:", data.authors);

  // Extract description text
  const descEl = document.querySelector(
    'div[data-testid="description"] span.Formatted'
  );
  data.description = descEl?.textContent.trim() || "";
  logger.debug("Extracted description:", data.description);

  // Extract series name and number if present
  const seriesAnchor = document.querySelector('h3[aria-label*="series"] a');
  if (seriesAnchor) {
    const fullText = seriesAnchor.textContent.trim();
    const match = fullText.match(/^(.*)\s*#([\d.]+)$/);
    if (match) {
      data.seriesName = match[1];
      data.seriesNumber = match[2];
    } else {
      data.seriesName = fullText;
      data.seriesNumber = "";
    }
    logger.debug("Extracted series:", {
      name: data.seriesName,
      number: data.seriesNumber,
    });
  }

  // Parse detailed authors and contributors with roles to avoid duplicates
  const authorsSet = new Set();
  const contributorsSet = new Set();
  const authors = [];
  const contributors = [];

  const container = document.querySelector(".ContributorLinksList");
  if (container) {
    // Select all spans with tabindex="-1" inside the container
    const allSpans = container.querySelectorAll("span[tabindex='-1']");

    allSpans.forEach((span) => {
      // For each span, find all contributor links
      span.querySelectorAll("a.ContributorLink").forEach((link) => {
        const nameEl = link.querySelector(".ContributorLink__name");
        const roleEl = link.querySelector(".ContributorLink__role");

        const name = nameEl?.textContent.trim() || "";
        const role =
          roleEl?.textContent.trim().replace(/[()\u00A0]/g, "") || "";

        // Distinguish contributors by presence of role, avoid duplicates
        if (role) {
          const key = `${name}|${role}`;
          if (!contributorsSet.has(key)) {
            contributors.push({ name, role });
            contributorsSet.add(key);
          }
        } else {
          if (!authorsSet.has(name)) {
            authors.push(name);
            authorsSet.add(name);
          }
        }
      });
    });
  }

  data.authors = authors;
  data.contributors = contributors;
  logger.debug("Final authors:", authors);
  logger.debug("Contributors:", contributors);

  // Extract edition details such as format, published date, ISBN, etc.
  const editionDetails = document.querySelector(".EditionDetails");
  if (editionDetails) {
    const items = editionDetails.querySelectorAll(".DescListItem");
    items.forEach((item) => {
      const label =
        item.querySelector("dt")?.textContent.trim().toLowerCase() || "";
      const value = item.querySelector("dd")?.textContent.trim() || "";

      switch (label) {
        case "format": {
          const parts = value.split(",");
          const rawFormat =
            parts.length === 1 ? parts[0].trim() : parts[1].trim();
          const pageMatch = parts[0].match(/\d+/);
          data.pageCount = pageMatch ? parseInt(pageMatch[0], 10) : null;

          // Normalize reading format and edition info
          const formatMap = {
            "audible audio": {
              readingFormat: "Audiobook",
              editionInfo: "Audible",
              editionFormat: "",
            },
            "audio cd": {
              readingFormat: "Audiobook",
              editionInfo: "CD",
              editionFormat: "",
            },
            "kindle edition": {
              readingFormat: "E-Book",
              editionInfo: "Kindle",
              editionFormat: "",
            },
            ebook: {
              readingFormat: "E-Book",
              editionInfo: "",
              editionFormat: "",
            },
            paperback: {
              readingFormat: "Physical Book",
              editionInfo: "Paperback",
              editionFormat: "",
            },
            hardcover: {
              readingFormat: "Physical Book",
              editionInfo: "Hardcover",
              editionFormat: "",
            },
          };

          const normalized = formatMap[rawFormat.toLowerCase()];
          if (normalized) {
            data.readingFormat = normalized.readingFormat;
            data.editionInfo = normalized.editionInfo;
            data.editionFormat = normalized.editionFormat || undefined;
          } else {
            data.editionFormat = rawFormat;
          }

          logger.debug("Extracted format:", {
            editionFormat: data.editionFormat,
            readingFormat: data.readingFormat,
            editionInfo: data.editionInfo,
            pageCount: data.pageCount,
          });
          break;
        }

        case "published": {
          data.releaseDate = value.split(" by ")[0].trim();
          const byIndex = value.toLowerCase().indexOf(" by ");
          if (byIndex !== -1) {
            data.publisher = value.substring(byIndex + 4).trim();
          }
          logger.debug("Extracted published date & publisher:", {
            releaseDate: data.releaseDate,
            publisher: data.publisher,
          });
          break;
        }

        case "isbn": {
          const cleaned = value.trim();
          const isbnMatch = cleaned.match(
            /(\d{13})(?:\s*\(ISBN10:\s*(\d{10})\))?/i
          );
          if (isbnMatch) {
            data.isbn13 = isbnMatch[1];
            if (isbnMatch[2]) {
              data.isbn10 = isbnMatch[2];
            }
          } else {
            const digits = cleaned.replace(/\D/g, "");
            if (digits.length === 13) data.isbn13 = digits;
            else if (digits.length === 10) data.isbn10 = digits;
          }
          logger.debug("Extracted ISBNs:", {
            isbn13: data.isbn13,
            isbn10: data.isbn10,
          });
          break;
        }

        case "asin": {
          data.asin = value.trim();
          logger.debug("Extracted ASIN:", data.asin);
          break;
        }

        case "language": {
          data.releaseLanguage = value;
          logger.debug("Extracted language:", data.releaseLanguage);
          break;
        }
      }
    });
  }

  logger.debug("Returning data object:", data);
  return data;
}

// ===== SECTION: Hardcover Functionality =====
// ===== FILE PATH: src/modules/hardcover.js ==========

/**
 * Checks if the current page is a hardcover.app import/edit page
 * by matching the URL against known patterns for manual/new edit pages.
 * Logs the URL and the result of the test.
 * @returns {boolean} True if on hardcover.app book import or edit page.
 */
function isHardcoverImportPage() {
  const logger = createLogger("isHardcoverImportPage");
  const url = location.href;
  const regex =
    /^https:\/\/hardcover\.app\/books\/([^/]+\/)?(editions\/[^/]+\/)?edit$|^https:\/\/hardcover\.app\/books\/new_manual$/;

  logger.debug("Testing url: ", url);
  const result = regex.test(url);
  logger.debug("Results: ", result);
  return result;
}

/**
 * Helper: Set value of input element by id and trigger input/change events.
 * @param {string} id - The id of the input element.
 * @param {string} value - The value to set.
 */
function setInputId(id, value) {
  const logger = createLogger("setInputId");
  logger.debug(`Setting input Id for field '${id}' to: `, value);

  const el = document.getElementById(id);
  if (!el || typeof value !== "string") {
    logger.debug(`Skipped '${id}' - element not found or value not a string.`);
    return;
  }

  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;

  nativeInputValueSetter?.call(el, value);

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));

  logger.debug(`Set input '${id}' to:`, value);
}

/**
 * Helper: Set value of input or textarea element by label text and trigger input/change events.
 * @param {string} labelText - The exact text content of the label.
 * @param {string|number} value - The value to set.
 */
function setInputLabel(labelText, value) {
  const logger = createLogger("setInputLabel");
  logger.debug(`Setting input for '${labelText}' to:`, value);

  if (typeof value !== "string" && typeof value !== "number") {
    logger.debug(`Skipped '${labelText}' - value not a string or number`);
    return;
  }
  const stringValue = String(value);

  const labels = Array.from(document.querySelectorAll("label"));
  const label = labels.find((l) => l.textContent.trim() === labelText);

  if (!label) {
    logger.debug(`Label '${labelText}' not found`);
    return;
  }

  const container = label.closest("div.border-t");

  if (!container) {
    logger.debug(`Container for label '${labelText}' not found`);
    return;
  }

  const input = container.querySelector("input, textarea");

  if (!input) {
    logger.debug(`Input or textarea for label '${labelText}' not found`);
    return;
  }

  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value"
  )?.set;

  setter?.call(input, stringValue);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  logger.debug(`Set input for '${labelText}' to:`, stringValue);
}

/**
 * Imports extracted book metadata into hardcover.app's book form fields.
 * Uses element IDs and label text to locate input fields.
 * Updates input values and dispatches 'input' and 'change' events
 * to trigger framework reactivity and UI updates.
 * Logs detailed debug information for each field set operation.
 *
 * @param {object} data - Book metadata object to import.
 */
function importBookDataToHardcover(data) {
  const logger = createLogger("importBookDataToHardcover");
  logger.debug("Called with data:", data);

  if (!data) {
    logger.warn("No data provided, exiting early.");
    return;
  }

  // Populate hardcover.app form fields from extracted data
  setInputId("field-title", data.title || "");
  setInputId("field-subtitle", data.subtitle || "");
  setInputId("field-isbn-10", data.isbn10 || "");
  setInputId("field-isbn-13", data.isbn13 || "");
  setInputId("field-asin", data.asin || "");
  setInputId("field-edition-format", data.editionFormat || "");

  setInputLabel("Description", data.description || "");
  setInputLabel("Page Count", data.pageCount);

  logger.info("Finished populating form fields.");
}

// ===== SECTION: Main =====
// ===== FILE PATH: src/core/main.js ==========

(function () {
  "use strict";

  // Create logger for this module
  const logger = createLogger("floatingBubble");

  // Store last URL to detect navigation changes
  let lastUrl = location.href;

  /**
   * Checks if the current page is a Hardcover import or edit page.
   * Uses a regex to match relevant URL patterns.
   * @returns {boolean} True if current page is a hardcover.app import/edit page.
   */
  function isHardcoverImportPage() {
    const url = location.href;
    const regex =
      /^https:\/\/hardcover\.app\/books\/([^/]+\/)?(editions\/[^/]+\/)?edit$|^https:\/\/hardcover\.app\/books\/new_manual$/;
    return regex.test(url);
  }

  /**
   * Initializes the floating bubble UI.
   * Sets up buttons and event handlers based on the current site context
   * and stored book data.
   */
  async function initFloatingBubble() {
    logger.info("Initializing floating bubble");

    // Get normalized host for site module detection
    const rawHost = location.hostname.toLowerCase();
    logger.debug(`rawHost: '${rawHost}'`);
    const host = rawHost.replace(/^www\./, "");

    // Normalize Amazon host to a generic key
    const normalizedHost = host.includes("amazon.") ? "amazon" : host;
    logger.debug(`normalizedHost: '${normalizedHost}'`);

    const module = siteModules[normalizedHost];
    const isImportPage = isHardcoverImportPage();

    let savedData = loadBookData();
    let hasSavedData = savedData && Object.keys(savedData).length > 0;
    logger.debug("Saved book data found:", hasSavedData);

    // Create floating bubble UI using UI module
    const { bubble, content } = UIComponents.createFloatingBubbleUI(logger);

    // Message container for displaying temporary feedback to user
    let messageEl = content.querySelector("#floatingBubbleMessage");
    if (!messageEl) {
      messageEl = UIComponents.createFloatingMessage();
      content.insertBefore(messageEl, content.firstChild);
    }

    /**
     * Displays a temporary message in the bubble for a set duration.
     * @param {string} msg - Message text to display.
     * @param {number} duration - Duration in ms before fading out.
     */
    function showTemporaryMessage(msg, duration = 3000) {
      UIComponents.showMessage(messageEl, msg, duration);
    }

    // Container for buttons in the bubble UI
    const btnContainer = document.createElement("div");
    btnContainer.style.marginBottom = "8px";

    // If site module exists and detects page type, add extract button
    if (module && module.detect()) {
      logger.debug("Extraction module detected for host:", host);

      const extractBtn = UIComponents.createButton(
        "📚 Extract Book Data",
        async () => {
          logger.info("Extract button clicked");
          const data = await module.extract();
          logger.debug("Extracted data:", data);
          saveBookData(data);
          updateContent(data);
          showTemporaryMessage("Book data extracted and saved.");
          copyJsonBtn.disabled = false; // enable copy button
        },
        { marginRight: "8px" }
      );

      btnContainer.appendChild(extractBtn);
    }

    // If on Hardcover import page, add import button
    if (isImportPage) {
      logger.debug("Hardcover import page detected");

      const importBtn = UIComponents.createButton(
        "⬇️ Import Book Data",
        () => {
          logger.info("Import button clicked");
          const data = loadBookData();
          if (!data || Object.keys(data).length === 0) {
            showTemporaryMessage(
              "No book data found. Please extract book data first."
            );
            logger.warn("Import attempted with no saved book data");
            return;
          }
          importBookDataToHardcover(data);
          showTemporaryMessage("Book data imported!");
          logger.info("Book data imported into Hardcover");
        },
        { marginRight: "8px" }
      );

      btnContainer.appendChild(importBtn);
    }

    // Button to copy JSON data to clipboard
    const copyJsonBtn = UIComponents.createButton(
      "📋 Copy JSON",
      () => {
        try {
          const jsonStr = JSON.stringify(loadBookData(), null, 2);
          navigator.clipboard.writeText(jsonStr).then(() => {
            showTemporaryMessage("Book JSON copied to clipboard.");
          });
        } catch (e) {
          showTemporaryMessage("Failed to copy JSON.");
          logger.error("Copy JSON failed:", e);
        }
      },
      {
        marginRight: "8px",
        disabled: !hasSavedData,
      }
    );

    btnContainer.appendChild(copyJsonBtn);

    // Button to refresh displayed book data in bubble
    const refreshBtn = UIComponents.createButton("🔄 Refresh", () => {
      const refreshedData = loadBookData();
      if (refreshedData && Object.keys(refreshedData).length > 0) {
        updateContent(refreshedData);
        copyJsonBtn.disabled = false;
        showTemporaryMessage("Book data refreshed.");
        logger.info("Book data refreshed via button");
      } else {
        updateContent({});
        copyJsonBtn.disabled = true;
        showTemporaryMessage("No book data found.");
        logger.info("No book data on refresh");
      }
    });

    btnContainer.appendChild(refreshBtn);

    content.appendChild(btnContainer);

    // Show saved book data in bubble on page load, if present
    if (hasSavedData) {
      updateContent(savedData);
      content.style.display = "block";
      bubble.style.height = "auto";
      logger.info("Displaying saved book data in bubble on load");
    }

    // Observe DOM mutations to detect URL changes for SPA navigation
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        const newData = loadBookData();
        if (newData && Object.keys(newData).length > 0) {
          updateContent(newData);
          copyJsonBtn.disabled = false;
          logger.info("Content preview updated on URL change");
        }
      }
    }).observe(document, { subtree: true, childList: true });

    /**
     * Updates the bubble's content area with formatted book metadata preview.
     * Displays text fields and cover image with click-to-copy functionality.
     * @param {object} data - The book metadata to display.
     */
    function updateContent(data) {
      logger.debug("Updating bubble content preview");

      // Remove any existing content container to replace
      const oldFlexContainer = content.querySelector(
        ".floatingBubbleFlexContainer"
      );
      if (oldFlexContainer) oldFlexContainer.remove();

      // Use UI module to create book display container
      const display = UIComponents.createBookDisplay(
        data,
        logger,
        showTemporaryMessage
      );
      display.className = "floatingBubbleFlexContainer";

      content.appendChild(display);
    }
  }

  /**
   * Checks for URL changes on single-page apps by polling.
   * If URL changes, removes existing bubble and reinitializes UI.
   */
  async function checkUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      logger.info("URL changed, reinitializing floating bubble.");
      // Remove existing bubble if present
      const existingBubble = document.getElementById("floatingBubble");
      if (existingBubble) existingBubble.remove();
      // Re-initialize bubble UI
      await initFloatingBubble();
    }
  }

  // Run floating bubble initialization immediately on script load
  initFloatingBubble();

  // Poll for URL changes every 2000ms (adjust interval as needed)
  const bubbleRefresh = 2000;
  setInterval(checkUrlChange, bubbleRefresh);
})();

