const TIERS = [
  { name: 'Plata', points: 500, commission: 1400000, key: 'plata' },
  { name: 'Oro', points: 1500, commission: 4200000, key: 'oro' },
  { name: 'Stars', points: 3000, commission: 8400000, key: 'stars' },
  { name: 'Diamante', points: 5000, commission: 14000000, key: 'diamante' },
  { name: 'Corona', points: 10000, commission: 28000000, key: 'corona' }
];

function getCurrentTier(commissions, personalPoints) {
  let currentTier = null;
  let nextTier = TIERS[0];

  if (personalPoints < 50) {
    return { currentTier: null, nextTier: TIERS[0] };
  }

  currentTier = { name: 'Master', points: 0, commission: 0, key: 'master' };

  for (let i = 0; i < TIERS.length; i++) {
    if (commissions >= TIERS[i].commission) {
      currentTier = TIERS[i];
      nextTier = TIERS[i + 1] || null;
    } else {
      nextTier = TIERS[i];
      break;
    }
  }

  return { currentTier, nextTier };
}

function calculateProgress(commissions, personalPoints) {
  if (commissions >= TIERS[TIERS.length - 1].commission) {
    return { percentage: 100, tier: TIERS[TIERS.length - 1] };
  }

  const { currentTier, nextTier } = getCurrentTier(commissions, personalPoints);

  if (!nextTier) {
    return { percentage: 100, tier: currentTier };
  }

  const previousCommission = currentTier ? currentTier.commission : 0;
  const targetCommission = nextTier.commission;
  const range = targetCommission - previousCommission;
  const progress = commissions - previousCommission;
  const percentage = (progress / range) * 100;

  return {
    percentage: Math.min(100, Math.max(0, percentage)),
    tier: currentTier || { name: 'Master', points: 0, commission: 0, key: 'master' },
    nextTier
  };
}

function updateProgressBar(commissions, personalPoints) {
  const progressBarContainer = document.getElementById('progressBarContainer');
  const activationAlert = document.getElementById('activationAlert');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressPercentage = document.getElementById('progressPercentage');
  const currentTierName = document.getElementById('currentTierName');
  const pointsToNextValue = document.getElementById('pointsToNextValue');

  if (!progressBarContainer || !activationAlert) {
    console.warn('Progress bar elements not found');
    return;
  }

  const totalCommissions = Number(commissions) || 0;
  const personalPts = Number(personalPoints) || 0;

  if (personalPts < 50) {
    progressBarContainer.style.display = 'none';
    activationAlert.style.display = 'block';
    return;
  }

  activationAlert.style.display = 'none';
  progressBarContainer.style.display = 'block';

  const { percentage, tier, nextTier } = calculateProgress(totalCommissions, personalPts);

  if (progressBarFill) {
    const displayPercentage = nextTier 
      ? Math.round(percentage)
      : 100;
    
    setTimeout(() => {
      progressBarFill.style.width = displayPercentage + '%';
      progressBarFill.setAttribute('data-tier', tier.key);
    }, 100);
  }

  if (progressPercentage) {
    const displayPercentage = nextTier 
      ? Math.round(percentage)
      : 100;
    progressPercentage.textContent = displayPercentage + '%';
  }

  if (currentTierName) {
    currentTierName.textContent = tier.name;
  }

  // Apply premium styling to "Rango actual" when user is Plata or higher
  const currentTierInfo = document.querySelector('.current-tier-info');
  if (currentTierInfo) {
    const isPlataPlusRank = tier.key && tier.key !== 'master';
    if (isPlataPlusRank) {
      currentTierInfo.classList.add('rank-premium');
    } else {
      currentTierInfo.classList.remove('rank-premium');
    }
  }

  if (pointsToNextValue) {
    if (nextTier) {
      const commissionsNeeded = nextTier.commission - totalCommissions;
      const formatted = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(commissionsNeeded);
      pointsToNextValue.textContent = formatted;
      document.getElementById('pointsToNext').style.display = 'inline';
    } else {
      document.getElementById('pointsToNext').style.display = 'none';
    }
  }

  const tierMarkers = document.querySelectorAll('.tier-marker');
  tierMarkers.forEach((marker) => {
    const tierCommission = parseInt(marker.getAttribute('data-commission'));
    if (totalCommissions >= tierCommission) {
      marker.classList.add('achieved');
    } else {
      marker.classList.remove('achieved');
    }
  });

  if (totalCommissions >= TIERS[TIERS.length - 1].commission) {
    setTimeout(() => {
      if (window.Swal) {
        Swal.fire({
          icon: 'success',
          title: '¡Felicitaciones!',
          html: '¡Has alcanzado el nivel <strong>Corona</strong>! 👑<br>Eres parte de la élite de PorkCasare.',
          confirmButtonText: 'Genial',
          showClass: {
            popup: 'animate__animated animate__fadeInDown'
          }
        });
      }
    }, 1800);
  }
}

document.addEventListener('pointsReady', (event) => {
  const personalPoints = event.detail.personalPoints || 0;
  const totalComisionesCobradas = event.detail.totalComisionesCobradas || 0;
  updateProgressBar(totalComisionesCobradas, personalPoints);
});

if (typeof window !== 'undefined') {
  window.updateProgressBar = updateProgressBar;
}

export { updateProgressBar, getCurrentTier, calculateProgress, TIERS };
