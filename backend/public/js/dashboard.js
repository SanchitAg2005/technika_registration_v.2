// Global state variables
let token = localStorage.getItem('token');
let currentUser = null;
let registeredEventIds = new Set();
let allEventsList = [];
let myTeamsList = [];
let lastNotifTimestamp = 0;
let lastTeamTimestamp = 0;

// Check authentication on load
if (!token) {
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', () => {
  // Navigation & Tab elements
  const navTabBtns = document.querySelectorAll('.nav-tab-btn');
  const sections = document.querySelectorAll('.dashboard-section');
  const logoutBtn = document.getElementById('logout-btn');

  // Modal elements
  const editProfileBtn = document.getElementById('edit-profile-btn');
  const editProfileModal = document.getElementById('edit-profile-modal');
  const closeEditModalBtn = document.getElementById('close-edit-modal-btn');
  const editProfileForm = document.getElementById('edit-profile-form');

  // Fetch initial profile and page details
  loadDashboardData().then(() => {
    startDashboardPolling();
  });

  // --- 1. Navigation & Tab Switching ---
  navTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetSectionId = btn.getAttribute('data-target');
      
      // Update nav button active states
      navTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show/Hide section panels
      sections.forEach(sec => {
        if (sec.id === targetSectionId) {
          sec.classList.remove('hidden');
        } else {
          sec.classList.add('hidden');
        }
      });

      // Trigger re-render of event enrollment lists to ensure categories render when tab becomes active
      if (targetSectionId === 'event-enrollment-section') {
        renderIndividualEnrollment();
        renderTeamEnrollment();
      }
    });
  });

  // --- 2. Logout Handler ---
  logoutBtn.addEventListener('click', () => {
    localStorage.clear();
    window.location.href = 'index.html';
  });

  // --- 3. Profile Receipt Download ---
  document.getElementById('download-receipt-btn').addEventListener('click', async () => {
    try {
      const response = await fetch('/api/auth/receipt', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error('Failed to generate receipt PDF.');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `receipt_${localStorage.getItem('registrationId') || 'technica'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error(err);
      alert('Error downloading receipt. Please try again.');
    }
  });

  // --- 4. Edit Profile Modal Triggers ---
  if (editProfileBtn) {
    editProfileBtn.addEventListener('click', () => {
      if (!currentUser) return;
      
      // Pre-populate details
      document.getElementById('edit-name').value = currentUser.name || '';
      document.getElementById('edit-age').value = currentUser.age || '';
      document.getElementById('edit-gender').value = currentUser.gender || 'Male';
      document.getElementById('edit-whatsapp').value = currentUser.whatsapp || '';
      document.getElementById('edit-institution').value = currentUser.institution || '';
      document.getElementById('edit-course').value = currentUser.course || '';
      document.getElementById('edit-semester').value = currentUser.semester || '';

      editProfileModal.classList.remove('hidden');
    });
  }

  if (closeEditModalBtn) {
    closeEditModalBtn.addEventListener('click', () => {
      editProfileModal.classList.add('hidden');
    });
  }

  if (editProfileForm) {
    editProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const payload = {
        name: document.getElementById('edit-name').value.trim(),
        age: parseInt(document.getElementById('edit-age').value),
        gender: document.getElementById('edit-gender').value,
        whatsapp: document.getElementById('edit-whatsapp').value.trim(),
        institution: document.getElementById('edit-institution').value.trim(),
        course: document.getElementById('edit-course').value.trim(),
        semester: document.getElementById('edit-semester').value.trim()
      };

      try {
        const response = await fetch('/api/auth/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to update profile.');

        alert('Profile updated successfully!');
        editProfileModal.classList.add('hidden');
        loadDashboardData(); // Reload details in dashboard
      } catch (err) {
        console.error(err);
        alert(err.message || 'Error updating profile.');
      }
    });
  }

  // --- 5. Event Search Handler ---
  const searchInput = document.getElementById('event-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      if (!query) {
        renderIndividualEnrollment(allEventsList);
        renderTeamEnrollment(allEventsList);
        return;
      }
      const filtered = allEventsList.filter(ev => 
        ev.name.toLowerCase().includes(query) || 
        ev.category.toLowerCase().includes(query)
      );
      renderIndividualEnrollment(filtered);
      renderTeamEnrollment(filtered);
    });
  }
});

// --- 4. Load Profile, Notifications, Events & Teams ---
async function loadDashboardData() {
  token = localStorage.getItem('token');
  if (!token) {
    window.location.href = 'index.html';
    return;
  }

  try {
    // A. Fetch required segments in parallel, conditionally adding static events list if not already loaded
    const promises = [
      fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch('/api/notifications', { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch('/api/teams/my-teams', { headers: { 'Authorization': `Bearer ${token}` } })
    ];

    const fetchEventsIndex = allEventsList.length === 0 ? promises.push(fetch('/api/events')) - 1 : -1;

    const responses = await Promise.all(promises);

    const meResponse = responses[0];
    const notificationsResponse = responses[1];
    const teamsResponse = responses[2];

    if (!meResponse.ok) {
      // Token might be expired
      localStorage.clear();
      window.location.href = 'index.html';
      return;
    }

    const [meData, notifications, teams] = await Promise.all([
      meResponse.json(),
      notificationsResponse.ok ? notificationsResponse.json() : [],
      teamsResponse.ok ? teamsResponse.json() : []
    ]);

    let events = allEventsList;
    if (fetchEventsIndex !== -1 && responses[fetchEventsIndex].ok) {
      events = await responses[fetchEventsIndex].json();
    }

    currentUser = meData.user;
    registeredEventIds = new Set(meData.registeredEvents.map(r => r.eventId));
    allEventsList = events;
    myTeamsList = teams;

    // Update Profile UI fields
    document.getElementById('profile-reg-id').textContent = currentUser.registrationId;
    document.getElementById('profile-name').textContent = currentUser.name;
    document.getElementById('profile-email').textContent = currentUser.email;
    document.getElementById('profile-whatsapp').textContent = currentUser.whatsapp;
    document.getElementById('profile-institution').textContent = currentUser.institution;
    document.getElementById('profile-academic-details').textContent = `${currentUser.course} - Sem ${currentUser.semester}`;
    document.getElementById('profile-utr').textContent = currentUser.paymentUTR;
    document.getElementById('profile-gender').textContent = currentUser.gender;

    // Render components
    renderNotificationsUI(notifications);
    renderRegisteredEvents(meData.registeredEvents);
    renderIndividualEnrollment();
    renderTeamEnrollment();

    // Set baseline timestamps for polling detector
    try {
      const pollRes = await fetch('/api/notifications/poll', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (pollRes.ok) {
        const pollData = await pollRes.json();
        lastNotifTimestamp = pollData.notifTimestamp;
        lastTeamTimestamp = pollData.teamTimestamp;
      }
    } catch (e) {
      console.warn('Failed to fetch initial poll timestamps:', e);
    }

  } catch (error) {
    console.error('Error loading dashboard data:', error);
  }
}

// --- 5. Notifications Rendering ---
function renderNotificationsUI(notifications) {
  const notifContainer = document.getElementById('notifications-container');
  const notifBadge = document.getElementById('notif-badge');

  // Count pending invites
  const pendingInvites = notifications.filter(n => n.type === 'TEAM_INVITE' && n.invitation && n.invitation.status === 'pending');
  
  if (pendingInvites.length > 0) {
    notifBadge.textContent = pendingInvites.length;
    notifBadge.classList.remove('hidden');
  } else {
    notifBadge.classList.add('hidden');
  }

  if (notifications.length === 0) {
    notifContainer.innerHTML = `
      <div style="text-align: center; color: var(--text-dark); padding: 40px 10px;">
        <i class="fa-solid fa-envelope-open" style="font-size: 2.2rem; margin-bottom: 12px;"></i>
        <p>Your inbox is empty. No notifications or team invites received yet.</p>
      </div>`;
    return;
  }

  let html = '';
  notifications.forEach(notif => {
    const dateStr = new Date(notif.createdAt).toLocaleDateString() + ' ' + new Date(notif.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    if (notif.type === 'TEAM_INVITE' && notif.invitation) {
      const inv = notif.invitation;
      
      if (inv.status === 'pending') {
        html += `
          <div class="notif-card">
            <div class="notif-info">
              <h4>Team Invitation: ${inv.eventName}</h4>
              <p>Leader <strong>${inv.senderName}</strong> (${inv.senderEmail}) invited you to join team <strong>${inv.teamId}</strong>.</p>
              <small style="color: var(--text-dark); font-size: 0.75rem;"><i class="fa-regular fa-clock"></i> ${dateStr}</small>
            </div>
            <div class="notif-actions">
              <button class="notif-btn-accept" onclick="respondToInvite('${notif._id}', 'accept')"><i class="fa-solid fa-check"></i> Accept</button>
              <button class="notif-btn-decline" onclick="respondToInvite('${notif._id}', 'decline')"><i class="fa-solid fa-xmark"></i> Decline</button>
            </div>
          </div>`;
      } else {
        // Invite responded already
        const statusText = inv.status === 'accepted' ? 'Accepted <i class="fa-solid fa-circle-check"></i>' : 'Declined <i class="fa-solid fa-circle-xmark"></i>';
        const statusColor = inv.status === 'accepted' ? 'var(--success)' : 'var(--error)';
        html += `
          <div class="notif-card" style="opacity: 0.65;">
            <div class="notif-info">
              <h4>Team Invitation: ${inv.eventName}</h4>
              <p>Invitation to team <strong>${inv.teamId}</strong> from ${inv.senderName} was <strong>${inv.status}</strong>.</p>
              <small style="color: var(--text-dark); font-size: 0.75rem;"><i class="fa-regular fa-clock"></i> ${dateStr}</small>
            </div>
            <div style="font-size: 0.85rem; font-weight: 600; color: ${statusColor};">${statusText}</div>
          </div>`;
      }
    } else {
      // Normal text message notifications (Invite accept logs, etc.)
      html += `
        <div class="notif-card" style="opacity: 0.85;">
          <div class="notif-info" style="flex: 1;">
            <h4>Notification Log</h4>
            <p>${notif.message}</p>
            <small style="color: var(--text-dark); font-size: 0.75rem;"><i class="fa-regular fa-clock"></i> ${dateStr}</small>
          </div>
          <div style="color: var(--text-dark); font-size: 1.1rem;"><i class="fa-regular fa-bell"></i></div>
        </div>`;
    }
  });

  notifContainer.innerHTML = html;
}

async function respondToInvite(notifId, action) {
  try {
    const response = await fetch(`/api/notifications/${notifId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to respond to invitation.');

    alert(data.message);
    // Reload dashboard to update profiles, events, and notifications
    loadDashboardData();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Error updating invitation response.');
  }
}

// Background refresh helpers for selective polling updates
async function refreshNotificationsOnly() {
  try {
    const res = await fetch('/api/notifications', { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
      const notifications = await res.json();
      renderNotificationsUI(notifications);
    }
  } catch (err) {
    console.error('Error refreshing notifications:', err);
  }
}

async function refreshTeamsAndRegistrationsOnly() {
  try {
    const [meResponse, teamsResponse] = await Promise.all([
      fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch('/api/teams/my-teams', { headers: { 'Authorization': `Bearer ${token}` } })
    ]);

    if (meResponse.ok && teamsResponse.ok) {
      const meData = await meResponse.json();
      const teams = await teamsResponse.json();

      currentUser = meData.user;
      registeredEventIds = new Set(meData.registeredEvents.map(r => r.eventId));
      myTeamsList = teams;

      renderRegisteredEvents(meData.registeredEvents);
      renderIndividualEnrollment();
      renderTeamEnrollment();
    }
  } catch (err) {
    console.error('Error refreshing teams and registrations:', err);
  }
}

// --- 6. Polling Update Loop ---
function startDashboardPolling() {
  setInterval(async () => {
    // Stop polling if the tab is in the background (visibility-aware API)
    if (document.hidden) return;

    token = localStorage.getItem('token');
    if (!token) return;

    try {
      const pollRes = await fetch('/api/notifications/poll', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (pollRes.ok) {
        const pollData = await pollRes.json();
        
        let needsNotifRefresh = pollData.notifTimestamp > lastNotifTimestamp;
        let needsTeamRefresh = pollData.teamTimestamp > lastTeamTimestamp;

        if (needsNotifRefresh || needsTeamRefresh) {
          console.log('[POLL] Background changes detected. Refreshing data...');
          
          if (needsNotifRefresh) {
            lastNotifTimestamp = pollData.notifTimestamp;
            await refreshNotificationsOnly();
          }
          
          if (needsTeamRefresh) {
            lastTeamTimestamp = pollData.teamTimestamp;
            await refreshTeamsAndRegistrationsOnly();
          }
        }
      }
    } catch (err) {
      console.warn('[POLL] Error checking for dashboard updates:', err.message);
    }
  }, 30000); // 30 seconds polling interval
}

// Render dynamic enrolled events list inside Profile tab
async function renderRegisteredEvents(registrations) {
  const container = document.getElementById('registered-events-container');
  if (registrations.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-dark); padding: 30px 10px;">
        <i class="fa-solid fa-receipt" style="font-size: 2rem; margin-bottom: 10px;"></i>
        <p>You have not registered for any events yet. Head over to the "Enroll Events" tab to register!</p>
      </div>`;
    return;
  }

  let html = '';
  registrations.forEach(reg => {
    // Find event name
    const event = allEventsList.find(e => e.eventId === reg.eventId);
    const eventName = event ? event.name : reg.eventId;
    const isTeam = reg.registrationType === 'TEAM';
    const badgeClass = isTeam ? 'badge-team' : 'badge-indiv';
    const typeLabel = isTeam ? `Team (${reg.teamId})` : 'Individual';

    html += `
      <div class="registered-event-item">
        <div>
          <h4>${eventName}</h4>
          <small style="color: var(--text-dark); font-size: 0.75rem;">Event ID: ${reg.eventId}</small>
        </div>
        <span class="${badgeClass}">${typeLabel}</span>
      </div>`;
  });

  container.innerHTML = html;
}

// --- 7. Category Navigation and Individual Events Enrollment Tab ---
let selectedCategory = 'All';

function getCategories(events) {
  const cats = new Set(events.map(e => e.category));
  return ['All', ...Array.from(cats)];
}

function renderCategoryTabs(events) {
  const container = document.getElementById('category-tabs-container');
  if (!container) return;

  const categories = getCategories(events);
  
  if (!categories.includes(selectedCategory)) {
    selectedCategory = 'All';
  }

  let html = '';
  categories.forEach(cat => {
    const activeClass = selectedCategory === cat ? 'active' : '';
    html += `<button class="category-tab-btn ${activeClass}" onclick="filterCategory('${cat}')">${cat}</button>`;
  });
  container.innerHTML = html;
}

function filterCategory(category) {
  selectedCategory = category;
  const indivPane = document.getElementById('enroll-indiv-pane');
  const isIndivActive = indivPane && !indivPane.classList.contains('hidden');
  if (isIndivActive) {
    renderIndividualEnrollment();
  } else {
    renderTeamEnrollment();
  }
}

function renderIndividualEnrollment(events = allEventsList) {
  const container = document.getElementById('indiv-events-list');
  const indivEvents = events.filter(e => e.individualAllowed);
  
  // Render dynamic horizontal category navigation bar only when tab is active
  const indivPane = document.getElementById('enroll-indiv-pane');
  const isIndivActive = indivPane && !indivPane.classList.contains('hidden');
  if (isIndivActive) {
    renderCategoryTabs(indivEvents);
  }

  // Filter events based on selected category
  const filteredEvents = indivEvents.filter(e => selectedCategory === 'All' || e.category === selectedCategory);
  
  if (filteredEvents.length === 0) {
    container.innerHTML = '<p class="help-text">No active individual events found in this category.</p>';
    return;
  }

  let html = `<div class="events-grid">`;
  filteredEvents.forEach(event => {
    const isRegistered = registeredEventIds.has(event.eventId);
    const isHybrid = event.teamAllowed;
    const hybridNote = isHybrid ? `<span class="event-badge" style="border: none; background: transparent; padding:0; color: #a5b4fc;"><i class="fa-solid fa-circle-info"></i> To participate with friends, register via the Team Events tab.</span>` : '';
    
    const btnHtml = isRegistered
      ? `<button class="submit-btn" disabled style="background: var(--text-dark); box-shadow: none; padding: 8px 15px; font-size: 0.85rem;"><i class="fa-solid fa-circle-check"></i> Enrolled</button>`
      : `<button class="submit-btn" style="padding: 8px 15px; font-size: 0.85rem;" onclick="enrollIndividual('${event.eventId}')">Register Solo</button>`;

    html += `
      <div class="event-card" style="cursor: default;">
        <div class="event-card-details" style="flex: 1;">
          <span class="event-card-title">${event.name}</span>
          <span class="event-card-desc">${event.description || ''}</span>
          <span class="event-badge" style="margin-top: 4px; display: inline-block;">Category: ${event.category}</span>
          ${hybridNote}
        </div>
        <div style="margin-left: 15px; display: flex; align-items: center;">
          ${btnHtml}
        </div>
      </div>`;
  });
  html += `</div>`;

  container.innerHTML = html;
}

async function enrollIndividual(eventId) {
  showEnrollAlert(null); // Clear alerts
  try {
    const response = await fetch('/api/events/register-individual', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ eventId })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Registration failed.');

    showEnrollAlert(`Successfully registered!`, 'success');
    loadDashboardData();
  } catch (err) {
    console.error(err);
    showEnrollAlert(err.message || 'Error enrolling in event.', 'error');
  }
}

// --- 8. Team Events Enrollment Tab ---
function renderTeamEnrollment(events = allEventsList) {
  const container = document.getElementById('team-events-list');
  const teamEvents = events.filter(e => e.teamAllowed);

  // Render horizontal category navigation bar only when tab is active
  const teamPane = document.getElementById('enroll-team-pane');
  const isTeamActive = teamPane && !teamPane.classList.contains('hidden');
  if (isTeamActive) {
    renderCategoryTabs(teamEvents);
  }

  // Filter events based on selected category
  const filteredEvents = teamEvents.filter(e => selectedCategory === 'All' || e.category === selectedCategory);

  if (filteredEvents.length === 0) {
    container.innerHTML = '<p class="help-text">No active team events found in this category.</p>';
    return;
  }

  let html = `<div class="events-grid">`;
  filteredEvents.forEach(event => {
    // Check if user is already in a team for this event
    const userTeam = myTeamsList.find(t => t.eventId === event.eventId);
    const isRegisteredSolo = registeredEventIds.has(event.eventId) && !userTeam;

    let innerCardContent = '';

    if (isRegisteredSolo) {
      // Registered individually - can convert to team
      innerCardContent = `
        <div style="margin-top: 10px; font-size: 0.85rem; color: #a5b4fc; background: rgba(99, 102, 241, 0.08); padding: 12px; border-radius: 6px; border: 1px solid rgba(99, 102, 241, 0.15); display: flex; flex-direction: column; gap: 8px;">
          <span><i class="fa-solid fa-circle-exclamation"></i> You have registered for this event individually. Convert your registration into a team to participate with friends.</span>
          <button class="submit-btn" style="width: auto; padding: 6px 12px; font-size: 0.8rem; background: var(--secondary); align-self: flex-end;" onclick="convertToTeam('${event.eventId}')">
            <i class="fa-solid fa-users-gear"></i> Convert to Team
          </button>
        </div>`;
    } else if (!userTeam) {
      // No team, show Create Team button
      innerCardContent = `
        <div style="margin-top: 12px; display: flex; justify-content: flex-end;">
          <button class="submit-btn" style="width: auto; padding: 8px 16px; font-size: 0.85rem;" onclick="createTeam('${event.eventId}')">
            <i class="fa-solid fa-users-plus"></i> Create Team
          </button>
        </div>`;
    } else {
      // Active team panel
      const teamStatusBadge = userTeam.status === 'registered' 
        ? `<span class="team-status-badge status-registered">Registered (Locked)</span>` 
        : `<span class="team-status-badge status-forming">Forming</span>`;

      let membersRows = '';
      userTeam.members.forEach(member => {
        const removeBtn = (userTeam.isLeader && userTeam.status === 'forming' && member.role !== 'Leader')
          ? `<button class="logout-btn" style="padding: 2px 8px; font-size: 0.7rem; margin-top: 0; display: inline-block;" onclick="removeRosterMember('${userTeam.teamId}', '${member.registrationId}', '${member.name}')"><i class="fa-solid fa-user-minus"></i> Remove</button>`
          : '';
        membersRows += `
          <div class="team-member-row" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px; background: rgba(0,0,0,0.15); border: 2px solid #000; margin-bottom: 6px;">
            <div style="display: flex; flex-direction: column; min-width: 120px; text-align: left;">
              <strong style="color: var(--text-main); font-size: 0.85rem;">${member.name}</strong>
              <span style="color: var(--text-muted); font-size: 0.75rem; word-break: break-all;">${member.email}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span style="color: ${member.role === 'Leader' ? 'var(--secondary)' : 'var(--text-muted)'}; font-weight: 800; font-size: 0.7rem; text-transform: uppercase; background: #000; padding: 2px 6px; border: 1px solid rgba(255,255,255,0.1);">${member.role}</span>
              ${removeBtn}
            </div>
          </div>`;
      });

      let pendingRows = '';
      userTeam.pendingInvites.forEach(inv => {
        const cancelBtn = (userTeam.isLeader && userTeam.status === 'forming')
          ? `<button class="logout-btn" style="padding: 2px 8px; font-size: 0.7rem; margin-top: 0; display: inline-block;" onclick="removeRosterMember('${userTeam.teamId}', '${inv.registrationId}', '${inv.name}', true)"><i class="fa-solid fa-xmark"></i> Cancel</button>`
          : '';
        pendingRows += `
          <div class="team-member-row" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px; background: rgba(0,0,0,0.1); border: 2px dashed rgba(255,255,255,0.15); margin-bottom: 6px; opacity: 0.85;">
            <div style="display: flex; flex-direction: column; min-width: 120px; text-align: left;">
              <strong style="color: var(--text-muted); font-size: 0.85rem;">${inv.name}</strong>
              <span style="color: var(--text-dark); font-size: 0.75rem; word-break: break-all;">${inv.email}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span style="color: var(--text-dark); font-weight: 800; font-size: 0.7rem; text-transform: uppercase; background: #000; padding: 2px 6px; border: 1px solid rgba(255,255,255,0.05);">Invited</span>
              ${cancelBtn}
            </div>
          </div>`;
      });

      let leaderControlsHtml = '';
      if (userTeam.isLeader && userTeam.status === 'forming') {
        // Invite block
        leaderControlsHtml = `
          <div class="invite-box">
            <input type="email" id="invite-email-${userTeam.teamId}" class="glassmorphism" style="background: var(--bg-color);" placeholder="Enter friend's Gmail address">
            <button class="action-btn-primary" style="padding: 8px 14px;" onclick="sendInvitation('${userTeam.teamId}')">Invite</button>
          </div>
        `;

        // Lock team button
        const canLock = userTeam.memberCount >= userTeam.minMembers;
        const lockDisabledAttr = canLock ? '' : 'disabled';
        const lockStyle = canLock ? 'box-shadow: 0 0 20px var(--secondary-glow);' : 'background: var(--text-dark); box-shadow: none;';
        
        leaderControlsHtml += `
          <div style="margin-top: 15px; display: flex; justify-content: space-between; align-items: center;">
            <small class="help-text">Requires min ${userTeam.minMembers} members to lock (current: ${userTeam.memberCount}).</small>
            <button class="submit-btn" style="width: auto; padding: 8px 20px; font-size: 0.85rem; ${lockStyle}" ${lockDisabledAttr} onclick="lockTeam('${userTeam.teamId}')">
              <i class="fa-solid fa-lock"></i> Lock & Register Team
            </button>
          </div>`;
      }

      const cancelBtnHtml = userTeam.status === 'forming'
        ? `<button class="logout-btn" style="padding: 4px 10px; font-size: 0.75rem; border-color: rgba(239, 68, 68, 0.5); margin-left: 5px; display: inline-block;" onclick="cancelTeamRegistration('${userTeam.teamId}', ${userTeam.isLeader})">
            ${userTeam.isLeader ? '<i class="fa-solid fa-users-slash"></i> Disband' : '<i class="fa-solid fa-right-from-bracket"></i> Leave'}
           </button>`
        : '';

      innerCardContent = `
        <div class="team-panel-card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 6px;">
            <span style="font-family: var(--font-heading); font-size: 0.9rem; font-weight: 700; color: #fff;">Team: ${userTeam.teamId}</span>
            <div style="display: flex; align-items: center; gap: 4px;">
              ${teamStatusBadge}
              ${cancelBtnHtml}
            </div>
          </div>
          
          <div class="team-members-list">
            <span style="font-size: 0.75rem; color: var(--text-dark); font-weight: 600; text-transform: uppercase;">Team Roster</span>
            ${membersRows}
            ${pendingRows}
          </div>

          ${leaderControlsHtml}
        </div>`;
    }

    html += `
      <div class="event-card" style="cursor: default; flex-direction: column; align-items: stretch; gap: 4px;">
        <div class="event-card-details">
          <span class="event-card-title">${event.name}</span>
          <span class="event-card-desc">${event.description || ''}</span>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px;">
            <span class="event-badge">Team size: ${event.minMembers} - ${event.maxMembers} members</span>
            <span class="event-badge" style="background: rgba(6, 182, 212, 0.08); color: var(--secondary); border-color: rgba(6, 182, 212, 0.15);">Category: ${event.category}</span>
          </div>
        </div>
        ${innerCardContent}
      </div>`;
  });
  html += `</div>`;

  container.innerHTML = html;
}

async function createTeam(eventId) {
  showEnrollAlert(null);
  try {
    const response = await fetch('/api/teams/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ eventId })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to create team.');

    showEnrollAlert(`Team successfully created! You are the leader.`, 'success');
    loadDashboardData();
  } catch (err) {
    console.error(err);
    showEnrollAlert(err.message || 'Error creating team.', 'error');
  }
}

async function sendInvitation(teamId) {
  const emailInput = document.getElementById(`invite-email-${teamId}`);
  const inviteeEmail = emailInput.value.trim();
  showEnrollAlert(null);

  if (!inviteeEmail) {
    showEnrollAlert('Please enter an email address to invite.', 'error');
    return;
  }

  try {
    const response = await fetch('/api/teams/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ teamId, inviteeEmail })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to send invite.');

    showEnrollAlert(data.message, 'success');
    emailInput.value = '';
    loadDashboardData();
  } catch (err) {
    console.error(err);
    showEnrollAlert(err.message || 'Error sending invite.', 'error');
  }
}

let isLockingTeam = false;
async function lockTeam(teamId) {
  if (isLockingTeam) return;
  isLockingTeam = true;
  showEnrollAlert(null);

  const lockBtn = document.querySelector(`button[onclick*="lockTeam('${teamId}')"]`);
  const originalText = lockBtn ? lockBtn.innerHTML : '';
  if (lockBtn) {
    lockBtn.disabled = true;
    lockBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Locking...';
  }

  try {
    const response = await fetch('/api/teams/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ teamId })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to lock team.');

    showEnrollAlert(data.message, 'success');
    loadDashboardData();
  } catch (err) {
    console.error(err);
    showEnrollAlert(err.message || 'Error locking team.', 'error');
    if (lockBtn) {
      lockBtn.disabled = false;
      lockBtn.innerHTML = originalText;
    }
  } finally {
    isLockingTeam = false;
  }
}

// // --- 9. Utility UI Helpers ---
function switchEnrollSubTab(tab) {
  const indivTrigger = document.getElementById('tab-indiv-trigger');
  const teamTrigger = document.getElementById('tab-team-trigger');
  const indivPane = document.getElementById('enroll-indiv-pane');
  const teamPane = document.getElementById('enroll-team-pane');

  // Reset category selection on tab change
  selectedCategory = 'All';

  if (tab === 'indiv') {
    indivTrigger.classList.add('active');
    teamTrigger.classList.remove('active');
    indivPane.classList.remove('hidden');
    teamPane.classList.add('hidden');
    renderIndividualEnrollment();
  } else {
    teamTrigger.classList.add('active');
    indivTrigger.classList.remove('active');
    teamPane.classList.remove('hidden');
    indivPane.classList.add('hidden');
    renderTeamEnrollment();
  }
  showEnrollAlert(null); // Clear alerts
}

function showEnrollAlert(message, type = 'success') {
  const panel = document.getElementById('enroll-alert');
  const msgText = document.getElementById('enroll-alert-message');
  const icon = document.getElementById('enroll-alert-icon');

  if (!message) {
    panel.classList.add('hidden');
    return;
  }

  msgText.textContent = message;
  panel.classList.remove('hidden');

  if (type === 'success') {
    panel.style.background = 'rgba(16, 185, 129, 0.1)';
    panel.style.borderColor = 'rgba(16, 185, 129, 0.2)';
    panel.style.color = '#a7f3d0';
    icon.className = 'fa-solid fa-circle-check';
    icon.style.color = 'var(--success)';
  } else {
    panel.style.background = 'rgba(239, 68, 68, 0.1)';
    panel.style.borderColor = 'rgba(239, 68, 68, 0.2)';
    panel.style.color = '#fca5a5';
    icon.className = 'fa-solid fa-circle-exclamation';
    icon.style.color = 'var(--error)';
  }
}

async function convertToTeam(eventId) {
  showEnrollAlert(null);
  if (!confirm('Are you sure you want to convert your individual registration into a team? This action cannot be reversed.')) {
    return;
  }

  try {
    const response = await fetch('/api/teams/convert-from-individual', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ eventId })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to convert registration.');

    showEnrollAlert(`Successfully converted! You are now the Team Leader.`, 'success');
    loadDashboardData();
  } catch (err) {
    console.error(err);
    showEnrollAlert(err.message || 'Error converting registration.', 'error');
  }
}

async function removeRosterMember(teamId, targetId, name, isInvite = false) {
  showEnrollAlert(null);
  const promptMessage = isInvite 
    ? `Are you sure you want to cancel the pending invitation for "${name}"?`
    : `Are you sure you want to remove "${name}" from your team?`;

  if (!confirm(promptMessage)) return;

  try {
    const response = await fetch('/api/teams/remove-member', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ teamId, targetUserId: targetId })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Operation failed.');

    showEnrollAlert(data.message, 'success');
    loadDashboardData();
  } catch (err) {
    console.error(err);
    showEnrollAlert(err.message || 'Error updating team roster.', 'error');
  }
}

async function cancelTeamRegistration(teamId, isLeader) {
  showEnrollAlert(null);
  const promptMessage = isLeader
    ? "Are you sure you want to disband this team? All members' registrations for this event will be cancelled and the team dissolved."
    : "Are you sure you want to leave this team? Your registration for this event will be cancelled.";

  if (!confirm(promptMessage)) return;

  try {
    const response = await fetch('/api/teams/cancel-registration', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ teamId })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Operation failed.');

    showEnrollAlert(data.message, 'success');
    loadDashboardData();
  } catch (err) {
    console.error(err);
    showEnrollAlert(err.message || 'Error cancelling registration.', 'error');
  }
}
