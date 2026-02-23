// oficina-virtual/js/mlm-simulation.js
// Simulador de comisiones MLM alineado con la logica real de confirm-order.js
// Solo renderiza dentro de #simulacion si existe. No modifica Firestore ni afecta balances.

const MLM = (() => {
  // Constantes centralizadas - Deben coincidir con confirm-order.js
  const POINT_VALUE = 2800;              // Valor del punto en COP
  const MAX_LEVELS = 5;                  // Niveles de profundidad unilevel
  const DISTRIBUTOR_RATE = 0.10;         // 10% comision por nivel (distribuidores)
  const RESTAURANT_RATE = 0.05;          // 5% comision por nivel (restaurantes)
  const QUICK_START_DIRECT = 21;         // Puntos al patrocinador directo por paquete de 50
  const QUICK_START_UPLINE = 1;          // Puntos a niveles 2-5 por paquete de 50
  const QUICK_START_THRESHOLD = 50;      // Umbral minimo para Quick Start Bonus
  const MONTHLY_ACTIVATION_POINTS = 10;  // Puntos personales minimos por mes
  const MIN_WITHDRAW_AMOUNT = 20000;     // Minimo de retiro en COP

  function format(n) {
    return Math.round(n).toLocaleString('es-CO');
  }

  // Simulacion Quick Start Bonus (primera compra >= 50 pts)
  // Aplica tanto para Distribuidores como para Restaurantes
  function calcQuickStart(points, levels) {
    const numLevels = Math.min(levels || MAX_LEVELS, MAX_LEVELS);
    const packages = Math.floor(points / QUICK_START_THRESHOLD);
    if (packages < 1) return { levels: [], totalPoints: 0, totalCOP: 0, packages: 0 };

    const result = [];
    let totalPts = 0;
    let totalCOP = 0;

    for (let i = 0; i < numLevels; i++) {
      const pts = i === 0 ? packages * QUICK_START_DIRECT : packages * QUICK_START_UPLINE;
      const cop = pts * POINT_VALUE;
      totalPts += pts;
      totalCOP += cop;
      result.push({
        level: i + 1,
        type: i === 0 ? 'quick_start_bonus' : 'quick_start_upper_level',
        points: pts,
        cop: cop
      });
    }

    return { levels: result, totalPoints: totalPts, totalCOP: totalCOP, packages: packages };
  }

  // Simulacion comision distribuidor recompra (10% uniforme)
  function calcDistributorCommission(points, levels) {
    const numLevels = Math.min(levels || MAX_LEVELS, MAX_LEVELS);
    const valorTotal = points * POINT_VALUE;
    const comisionCOP = valorTotal * DISTRIBUTOR_RATE;
    const comisionPts = points * DISTRIBUTOR_RATE;

    const result = [];
    let totalPts = 0;
    let totalCOP = 0;

    for (let i = 0; i < numLevels; i++) {
      totalPts += comisionPts;
      totalCOP += comisionCOP;
      result.push({
        level: i + 1,
        type: 'commission_normal',
        points: comisionPts,
        cop: comisionCOP
      });
    }

    return { levels: result, totalPoints: totalPts, totalCOP: totalCOP };
  }

  // Simulacion comision restaurante (5% uniforme)
  function calcRestaurantCommission(points, levels) {
    const numLevels = Math.min(levels || MAX_LEVELS, MAX_LEVELS);
    const comisionPts = points * RESTAURANT_RATE;
    const comisionCOP = Math.round(comisionPts * POINT_VALUE);

    const result = [];
    let totalPts = 0;
    let totalCOP = 0;

    for (let i = 0; i < numLevels; i++) {
      totalPts += comisionPts;
      totalCOP += comisionCOP;
      result.push({
        level: i + 1,
        type: 'restaurant_commission',
        points: comisionPts,
        cop: comisionCOP
      });
    }

    return { levels: result, totalPoints: totalPts, totalCOP: totalCOP };
  }

  // Renderizado en contenedor #simulacion (compatibilidad)
  function render() {
    const container = document.getElementById('simulacion');
    if (!container) return;

    const scenarios = [
      { label: 'Quick Start Distribuidor (50 pts)', calc: calcQuickStart(50, MAX_LEVELS) },
      { label: 'Quick Start Distribuidor (100 pts)', calc: calcQuickStart(100, MAX_LEVELS) },
      { label: 'Quick Start Restaurante (50 pts)', calc: calcQuickStart(50, MAX_LEVELS) },
      { label: 'Quick Start Restaurante (100 pts)', calc: calcQuickStart(100, MAX_LEVELS) },
      { label: 'Recompra Dist (30 pts)', calc: calcDistributorCommission(30, MAX_LEVELS) },
      { label: 'Restaurante Recompra (20 pts)', calc: calcRestaurantCommission(20, MAX_LEVELS) }
    ];

    let html = `
      <div class="mlm-card">
        <p><strong>Valor del punto:</strong> $${format(POINT_VALUE)} COP</p>
        <p><strong>Comision distribuidores:</strong> ${(DISTRIBUTOR_RATE * 100)}% por nivel (5 niveles, uniforme)</p>
        <p><strong>Comision restaurantes:</strong> ${(RESTAURANT_RATE * 100)}% por nivel (5 niveles, uniforme)</p>
        <p><strong>Quick Start Bonus:</strong> ${QUICK_START_DIRECT} pts al patrocinador + ${QUICK_START_UPLINE} pt a niveles 2-5 por cada paquete de ${QUICK_START_THRESHOLD} pts (aplica para Distribuidores y Restaurantes en primera compra)</p>
        <p><strong>Activacion mensual:</strong> ${MONTHLY_ACTIVATION_POINTS} pts personales</p>
        <p><strong>Minimo retiro:</strong> $${format(MIN_WITHDRAW_AMOUNT)} COP</p>

        <table class="mlm-table" role="table" aria-label="Simulacion de comisiones">
          <thead>
            <tr>
              <th>Escenario</th>
              <th>Total Puntos Distribuidos</th>
              <th>Total COP Distribuidos</th>
            </tr>
          </thead>
          <tbody>
    `;

    scenarios.forEach(s => {
      html += `
        <tr>
          <td>${s.label}</td>
          <td>${s.calc.totalPoints.toFixed(2)} pts</td>
          <td><strong>$${format(s.calc.totalCOP)}</strong></td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = html;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => render());
  } else {
    render();
  }

  return {
    render,
    calcQuickStart,
    calcDistributorCommission,
    calcRestaurantCommission,
    POINT_VALUE,
    MAX_LEVELS,
    DISTRIBUTOR_RATE,
    RESTAURANT_RATE,
    QUICK_START_DIRECT,
    QUICK_START_UPLINE,
    QUICK_START_THRESHOLD,
    MONTHLY_ACTIVATION_POINTS,
    MIN_WITHDRAW_AMOUNT
  };
})();

export default MLM;
