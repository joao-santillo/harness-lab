(function () {
  "use strict";

  var timeline = document.querySelector("[data-round-timeline]");
  if (!timeline) {
    return;
  }

  var roundId = timeline.getAttribute("data-round-id");
  if (!roundId) {
    return;
  }

  var terminalStates = {
    recommended: true,
    rejected: true,
    inconclusive: true,
    pending_validation: true,
    validation_insufficient: true,
    stopped_by_limit: true,
    cancelled: true,
    integration_failed: true,
  };

  var stateBadge = document.querySelector("[data-round-state]");
  var lastSequence = parseInt(timeline.getAttribute("data-last-sequence"), 10);
  if (isNaN(lastSequence)) {
    lastSequence = -1;
  }

  function appendEvent(data) {
    var emptyItem = timeline.querySelector("[data-empty]");
    if (emptyItem) {
      emptyItem.remove();
    }
    if (typeof data.sequence === "number" && data.sequence <= lastSequence) {
      return;
    }
    var item = document.createElement("li");
    if (typeof data.sequence === "number") {
      item.setAttribute("data-sequence", String(data.sequence));
      lastSequence = data.sequence;
    }
    var code = document.createElement("strong");
    code.textContent = data.messageCode || data.event || "evento";
    var when = document.createElement("span");
    when.textContent = data.occurredAt || "";
    item.appendChild(code);
    item.appendChild(when);
    timeline.appendChild(item);

    if (stateBadge && data.state) {
      stateBadge.textContent = data.state;
      stateBadge.className = "state-badge state-" + String(data.state).toLowerCase();
    }
    if (data.state && terminalStates[data.state]) {
      source.close();
      window.setTimeout(function () {
        window.location.reload();
      }, 400);
    }
  }

  var source = new EventSource("/api/v1/rounds/" + encodeURIComponent(roundId) + "/events");
  source.addEventListener("round-progress", function (message) {
    try {
      appendEvent(JSON.parse(message.data));
    } catch (error) {
      /* ignore malformed frames */
    }
  });
  source.addEventListener("error", function () {
    /* EventSource reconnects automatically; nothing to do */
  });
})();
