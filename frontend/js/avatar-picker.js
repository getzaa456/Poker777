(function () {
  const STORAGE_KEY = "poker777-avatar-id";

  const AVATARS = [
    {
      id: 1,
      alt: "Avatar 1",
      svg: function (maskId) {
        return (
          '<svg viewBox="0 0 36 36" fill="none" role="img" xmlns="http://www.w3.org/2000/svg" width="40" height="40" aria-hidden="true">' +
          '<mask id="' + maskId + '" maskUnits="userSpaceOnUse" x="0" y="0" width="36" height="36">' +
          '<rect width="36" height="36" rx="72" fill="#FFFFFF"/>' +
          "</mask>" +
          '<g mask="url(#' + maskId + ')">' +
          '<rect width="36" height="36" fill="#ff005b"/>' +
          '<rect x="0" y="0" width="36" height="36" transform="translate(9 -5) rotate(219 18 18) scale(1)" fill="#ffb238" rx="6"/>' +
          '<g transform="translate(4.5 -4) rotate(9 18 18)">' +
          '<path d="M15 19c2 1 4 1 6 0" stroke="#000000" fill="none" stroke-linecap="round"/>' +
          '<rect x="10" y="14" width="1.5" height="2" rx="1" stroke="none" fill="#000000"/>' +
          '<rect x="24" y="14" width="1.5" height="2" rx="1" stroke="none" fill="#000000"/>' +
          "</g></g></svg>"
        );
      },
    },
    {
      id: 2,
      alt: "Avatar 2",
      svg: function (maskId) {
        return (
          '<svg viewBox="0 0 36 36" fill="none" role="img" xmlns="http://www.w3.org/2000/svg" width="40" height="40" aria-hidden="true">' +
          '<mask id="' + maskId + '" maskUnits="userSpaceOnUse" x="0" y="0" width="36" height="36">' +
          '<rect width="36" height="36" rx="72" fill="#FFFFFF"></rect>' +
          "</mask>" +
          '<g mask="url(#' + maskId + ')">' +
          '<rect width="36" height="36" fill="#ff7d10"></rect>' +
          '<rect x="0" y="0" width="36" height="36" transform="translate(5 -1) rotate(55 18 18) scale(1.1)" fill="#0a0310" rx="6"/>' +
          '<g transform="translate(7 -6) rotate(-5 18 18)">' +
          '<path d="M15 20c2 1 4 1 6 0" stroke="#FFFFFF" fill="none" stroke-linecap="round"/>' +
          '<rect x="14" y="14" width="1.5" height="2" rx="1" stroke="none" fill="#FFFFFF"/>' +
          '<rect x="20" y="14" width="1.5" height="2" rx="1" stroke="none" fill="#FFFFFF"/>' +
          "</g></g></svg>"
        );
      },
    },
    {
      id: 3,
      alt: "Avatar 3",
      svg: function (maskId) {
        return (
          '<svg viewBox="0 0 36 36" fill="none" role="img" xmlns="http://www.w3.org/2000/svg" width="40" height="40" aria-hidden="true">' +
          '<mask id="' + maskId + '" maskUnits="userSpaceOnUse" x="0" y="0" width="36" height="36">' +
          '<rect width="36" height="36" rx="72" fill="#FFFFFF"></rect>' +
          "</mask>" +
          '<g mask="url(#' + maskId + ')">' +
          '<rect width="36" height="36" fill="#0a0310"/>' +
          '<rect x="0" y="0" width="36" height="36" transform="translate(-3 7) rotate(227 18 18) scale(1.2)" fill="#ff005b" rx="36"/>' +
          '<g transform="translate(-3 3.5) rotate(7 18 18)">' +
          '<path d="M13,21 a1,0.75 0 0,0 10,0" fill="#FFFFFF"/>' +
          '<rect x="12" y="14" width="1.5" height="2" rx="1" stroke="none" fill="#FFFFFF"/>' +
          '<rect x="22" y="14" width="1.5" height="2" rx="1" stroke="none" fill="#FFFFFF"/>' +
          "</g></g></svg>"
        );
      },
    },
    {
      id: 4,
      alt: "Avatar 4",
      svg: function (maskId) {
        return (
          '<svg viewBox="0 0 36 36" fill="none" role="img" xmlns="http://www.w3.org/2000/svg" width="40" height="40" aria-hidden="true">' +
          '<mask id="' + maskId + '" maskUnits="userSpaceOnUse" x="0" y="0" width="36" height="36">' +
          '<rect width="36" height="36" rx="72" fill="#FFFFFF"></rect>' +
          "</mask>" +
          '<g mask="url(#' + maskId + ')">' +
          '<rect width="36" height="36" fill="#d8fcb3"></rect>' +
          '<rect x="0" y="0" width="36" height="36" transform="translate(9 -5) rotate(219 18 18) scale(1)" fill="#89fcb3" rx="6"></rect>' +
          '<g transform="translate(4.5 -4) rotate(9 18 18)">' +
          '<path d="M15 19c2 1 4 1 6 0" stroke="#000000" fill="none" stroke-linecap="round"></path>' +
          '<rect x="10" y="14" width="1.5" height="2" rx="1" stroke="none" fill="#000000"></rect>' +
          '<rect x="24" y="14" width="1.5" height="2" rx="1" stroke="none" fill="#000000"></rect>' +
          "</g></g></svg>"
        );
      },
    },
  ];

  function getAvatar(id) {
    return AVATARS.find(function (a) {
      return a.id === id;
    }) || AVATARS[0];
  }

  function loadSavedId() {
    var raw = localStorage.getItem(STORAGE_KEY);
    var id = raw ? parseInt(raw, 10) : 1;
    return getAvatar(id).id;
  }

  window.initAvatarPicker = function (options) {
    var headerEl = document.getElementById(options.headerId);
    var mainWrap = document.getElementById(options.mainId);
    var choicesEl = document.getElementById(options.choicesId);
    var selectedId = loadSavedId();
    var rotationCount = 0;

    function renderFace(target, avatar, prefix, scaled) {
      target.innerHTML =
        '<div class="avatar-svg-inner' +
        (scaled ? " is-scaled" : "") +
        '">' +
        avatar.svg(prefix + "-" + avatar.id) +
        "</div>";
    }

    function paintSelection() {
      var avatar = getAvatar(selectedId);
      renderFace(headerEl, avatar, "hdr", false);
      renderFace(mainWrap, avatar, "main", false);
      mainWrap.style.transform = "rotate(" + rotationCount + "deg)";

      var buttons = choicesEl.querySelectorAll("[data-avatar-id]");
      buttons.forEach(function (btn) {
        var isActive = parseInt(btn.getAttribute("data-avatar-id"), 10) === selectedId;
        btn.classList.toggle("is-selected", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }

    function selectAvatar(id, spin) {
      selectedId = id;
      localStorage.setItem(STORAGE_KEY, String(id));
      if (spin) {
        rotationCount += 1080;
      }
      paintSelection();
    }

    choicesEl.innerHTML = AVATARS.map(function (avatar) {
      return (
        '<button type="button" class="avatar-choice" data-avatar-id="' +
        avatar.id +
        '" aria-label="Select ' +
        avatar.alt +
        '" aria-pressed="false">' +
        '<span class="avatar-choice-face">' +
        avatar.svg("pick-" + avatar.id) +
        "</span>" +
        '<span class="avatar-choice-ring" aria-hidden="true"></span>' +
        "</button>"
      );
    }).join("");

    choicesEl.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-avatar-id]");
      if (!btn) return;
      var id = parseInt(btn.getAttribute("data-avatar-id"), 10);
      if (id === selectedId) return;
      selectAvatar(id, true);
    });

    paintSelection();
  };
})();
