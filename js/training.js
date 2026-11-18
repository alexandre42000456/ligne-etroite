// Centre de formation : parcours étroits isolés pour les défis (mètres, x → est, y → sud)
const bays = (x0, n, w, y0, y1) => Array.from({ length: n + 1 }, (_, i) => ({ pts: [[x0 + i * w, y0], [x0 + i * w, y1]], w: 0.15, color: '#f2f2ee' }));

export const TRAINING = {
  name: 'Centre de formation',
  size: [600, 430],
  seed: 4242,
  nodes: {
    // B — couloir en L
    K0: [214, 125], K1: { p: [300, 125], cr: 8.5 }, K2: { p: [300, 50], cr: 8.5 }, K3: [386, 50],
    // C — épingle (raquette de retournement)
    H0: [414, 92], HR: { p: [544, 92], ring: { ri: 3.2, ra: 4.6, ro: 12.0, sw: 0.7 } },
    // D — chicane
    Q0: [14, 250], Q1: [62, 250], Q2: [88, 230], Q3: [118, 230], Q4: [144, 250], Q5: [196, 250],
    // E — mini-giratoire
    GR: { p: [300, 228], ring: { ri: 5.5, ra: 7.6, ro: 11.5, sw: 1.2 } },
    GW: [212, 228], GE: [388, 228], GN: [300, 162], GS: [300, 296],
    // F — porte étroite puis virage
    P0: [414, 262], P1: [478, 262], P2: [500, 262], P3: { p: [532, 262], cr: 7.5 }, P4: [532, 168],
  },
  streets: [
    { name: 'Couloir de manœuvre', path: ['K0', 'K1', 'K2', 'K3'], w: 4.9, sw: 0.5, speed: 20, oneway: true, lamps: false },
    { name: 'Impasse de l’Épingle', path: ['H0', 'HR'], w: 6.4, sw: 0.7, speed: 20, lamps: false, center: true },
    { name: 'Chicane', path: ['Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5'], w: 4.6, sw: 0.7, speed: 20, oneway: true, lamps: false },
    { name: 'Rue du Giratoire', path: ['GW', 'GR', 'GE'], w: 6.6, sw: 1.2, speed: 30, lamps: false, center: true },
    { name: 'Rue du Giratoire', path: ['GN', 'GR', 'GS'], w: 6.6, sw: 1.2, speed: 30, lamps: false, center: true },
    { name: 'Rue de la Herse', path: ['P0', 'P1'], w: 6.2, sw: 1.0, speed: 20, oneway: true, lamps: false, style: 'cobble' },
    { name: 'Porte de la Herse', path: ['P1', 'P2'], w: 3.6, sw: 0, speed: 10, oneway: true, lamps: false, style: 'cobble', gate: true },
    { name: 'Rue de la Herse', path: ['P2', 'P3', 'P4'], w: 4.8, sw: 0.7, speed: 20, oneway: true, lamps: false, style: 'cobble' },
  ],
  areas: [
    { type: 'road', poly: [[14, 14], [196, 14], [196, 146], [14, 146]] },   // A — cour du dépôt
    { type: 'road', poly: [[14, 332], [386, 332], [386, 422], [14, 422]] }, // G — cour logistique
  ],
  buildings: [
    // séparateurs de quais
    ...[146, 151, 156, 161, 166].map((x) => ({ poly: [[x, 331], [x + 1, 331], [x + 1, 347], [x, 347]], style: 'dock' })),
  ],
  props: [],
  bollards: [
    { edge: ['Q1', 'Q2'], side: 1, from: 4, to: 28, step: 2.2, lat: 0.35 },
    { edge: ['Q3', 'Q4'], side: -1, from: 4, to: 28, step: 2.2, lat: 0.35 },
  ],
  paint: [
    ...bays(108.1, 7, 3.8, 132, 146),
    { pts: [[108.1, 132], [134.7, 132]], w: 0.15, color: '#f2f2ee' },
    ...[146.5, 151.5, 156.5, 161.5, 166.5].map((x) => ({ pts: [[x, 347], [x, 362]], w: 0.2, color: '#f5c400' })),
    { pts: [[178, 33], [178, 47]], w: 0.3, color: '#f2f2ee', dash: [0.8, 0.6] },
  ],
  stops: {},
  lines: [],
};
