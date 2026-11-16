// Données de la ville (mètres, x → est, y → sud)
// Rues étroites façon centre-ville européen : 3,6 m (porte) à 11 m (boulevard).

export const CITY = {
  size: [780, 560],
  seed: 1977,

  nodes: {
    // anneau nord
    NW: [40, 40], N2: [260, 40], AN: [380, 40], N3: [520, 40], N4: [660, 40], NE: [740, 40],
    // ouest
    WM: [40, 170], BW: [40, 300], WS: [40, 420], SW: [40, 500],
    // est
    EM: [740, 150], BE: [740, 300], ES: [740, 410], SE: [740, 500],
    // quai
    AS: [380, 500], S3: [520, 500], S4: [630, 500],
    // boulevard
    B1: { p: [160, 300], zebra: true },
    B2: { p: [260, 300], signal: true, zebra: true },
    R: { p: [380, 300], ring: { ri: 10, ra: 12.5, ro: 19.5, sw: 3.5 } },
    B3: { p: [520, 300], signal: true, zebra: true },
    B4: { p: [630, 300], zebra: true },
    // avenue
    A1: { p: [380, 170], signal: true, zebra: true },
    A2: { p: [380, 410], signal: true, zebra: true },
    // quartier de l'hôpital
    H1: [160, 170], H2: { p: [260, 170], zebra: true },
    // gare
    G1: { p: [160, 420], zebra: true },
    G2: { p: [260, 420], signal: true, zebra: true },
    // résidentiel
    P1: [520, 410], V1: [630, 410],
    // vieille ville
    OT1: { p: [500, 215], br: 0.4 },
    OT2: { p: [485, 168], br: 0.4, cr: 4.2 },
    OT3: { p: [600, 160], br: 0.4 },
    OT4: { p: [530, 110], br: 0.4 },
    OT5: { p: [640, 110], br: 0.4 },
    OT6: { p: [610, 225], br: 0.4 },
    GI: [672, 152], GO: [698, 151],
  },

  streets: [
    { name: 'Rue du Nord', path: ['NW', 'N2', 'AN', 'N3', 'N4', 'NE'], w: 7, sw: 2.2, speed: 50, center: true },
    { name: "Boulevard de l'Ouest", path: ['NW', 'WM', 'BW', 'WS', 'SW'], w: 8, sw: 3, speed: 50, trees: true, center: true },
    { name: "Rue de l'Est", path: ['NE', 'EM', 'BE', 'ES', 'SE'], w: 7, sw: 2.5, speed: 50, center: true },
    { name: 'Quai de la Rivière', path: ['SW', 'AS', 'S3', 'S4', 'SE'], w: 8, sw: 3, speed: 50, trees: true, center: true },
    { name: 'Boulevard de la République', path: ['BW', 'B1', 'B2', 'R', 'B3', 'B4', 'BE'], w: 11, sw: 4, speed: 50, park: 'B', trees: true, center: true },
    { name: 'Avenue Jean-Jaurès', path: ['AN', 'A1', 'R', 'A2', 'AS'], w: 8.5, sw: 3.5, speed: 50, trees: true, center: true },
    { name: "Rue de l'Hôpital", path: ['WM', 'H1', 'H2', 'A1'], w: 7.2, sw: 2.5, speed: 50, park: 'R', center: true },
    { name: 'Rue Molière', path: ['H1', 'B1'], w: 6, sw: 1.8, speed: 30, center: true },
    { name: 'Rue des Écoles', path: ['N2', 'H2', 'B2'], w: 6, sw: 1.8, speed: 30, center: true },
    { name: 'Rue de la Gare', path: ['B1', 'G1'], w: 7, sw: 2.5, speed: 50, center: true },
    { name: 'Rue Gambetta', path: ['WS', 'G1', 'G2', 'A2'], w: 8, sw: 3, speed: 50, center: true },
    { name: 'Rue Lamartine', path: ['G2', 'B2'], w: 5.6, sw: 1.8, speed: 30, center: true },
    { name: 'Avenue de la Gare', path: ['G2', 'R'], w: 9, sw: 3.5, speed: 50, trees: true, center: true },
    { name: 'Rue Pasteur', path: ['B3', 'P1', 'S3'], w: 7.2, sw: 2, speed: 30, park: 'L' },
    { name: 'Rue Victor-Hugo', path: ['B4', 'V1', 'S4'], w: 7.2, sw: 2, speed: 30, park: 'R' },
    { name: 'Rue des Lilas', path: ['A2', 'P1', 'V1', 'ES'], w: 7.2, sw: 2.2, speed: 30, park: 'R' },
    // Vieille ville (pavés, très étroit)
    { name: 'Grande Rue', path: ['A1', [420, 168], [455, 174], 'OT2'], w: 5.4, sw: 1.3, speed: 30, style: 'cobble', lamps: false },
    { name: 'Rue du Marché', path: ['OT2', 'OT3'], w: 5.2, sw: 1.2, speed: 20, style: 'cobble', lamps: false },
    { name: 'Rue de la Porte', path: ['OT3', [640, 154], 'GI'], w: 4.4, sw: 1.0, speed: 20, style: 'cobble', oneway: true, lamps: false },
    { name: 'Porte Saint-Jean', path: ['GI', 'GO'], w: 3.8, sw: 0, speed: 20, style: 'cobble', oneway: true, lamps: false, gate: true },
    { name: 'Rue de la Porte', path: ['GO', 'EM'], w: 4.4, sw: 1.0, speed: 20, style: 'cobble', oneway: true, lamps: false },
    { name: 'Rue des Moines', path: ['N3', [523, 75], 'OT4'], w: 4.2, sw: 0.9, speed: 20, style: 'cobble', oneway: true, lamps: false },
    { name: 'Rue de la Halle', path: ['OT4', [585, 104], 'OT5'], w: 4.8, sw: 1.0, speed: 20, style: 'cobble', lamps: false },
    { name: 'Rue des Carmes', path: ['OT5', [655, 72], 'N4'], w: 4.2, sw: 0.9, speed: 20, style: 'cobble', oneway: true, lamps: false },
    { name: 'Rue Saint-Pierre', path: ['OT4', [505, 138], 'OT2'], w: 4.2, sw: 0.9, speed: 20, style: 'cobble', oneway: true, lamps: false },
    { name: 'Rue du Château', path: ['B3', [518, 265], [508, 238], 'OT1'], w: 5.6, sw: 1.5, speed: 30, style: 'cobble', lamps: false },
    { name: 'Rue Basse', path: ['OT1', [491, 190], 'OT2'], w: 5, sw: 1.1, speed: 20, style: 'cobble', lamps: false },
    { name: 'Rue des Tanneurs', path: ['OT1', [555, 222], 'OT6'], w: 4.8, sw: 1.0, speed: 20, style: 'cobble', lamps: false },
    { name: "Rue de l'Église", path: ['OT6', [606, 192], 'OT3'], w: 4.8, sw: 1.0, speed: 20, style: 'cobble', lamps: false },
    { name: 'Rue des Remparts', path: ['OT6', [655, 245], [640, 278], 'B4'], w: 5.2, sw: 1.2, speed: 30, style: 'cobble', lamps: false },
  ],

  // surfaces : walk (place/promenade), grass, water, road
  areas: [
    { type: 'water', poly: [[0, 514], [780, 514], [780, 560], [0, 560]] },
    { type: 'walk', poly: [[0, 505], [780, 505], [780, 515], [0, 515]], style: 'promenade' },
    { type: 'walk', poly: [[52, 424], [330, 424], [330, 452], [52, 452]], style: 'plaza' },
    { type: 'grass', poly: [[46, 46], [255, 46], [255, 164], [46, 164]] },
    { type: 'walk', poly: [[490, 169], [603, 161], [609, 222], [497, 215]], style: 'plaza' },
    { type: 'grass', poly: [[635, 309], [735, 309], [735, 405], [635, 405]] },
    { type: 'grass', poly: [[636, 416], [734, 416], [734, 494], [636, 494]] },
    { type: 'grass', poly: [[170, 312], [250, 312], [250, 352], [170, 352]] },
  ],

  buildings: [
    { poly: [[85, 452], [305, 452], [305, 492], [85, 492]], style: 'station', label: 'GARE' },
    { poly: [[70, 66], [232, 66], [232, 142], [70, 142]], style: 'hospital', label: 'HÔPITAL' },
    { poly: [[546, 184], [592, 181], [594, 211], [548, 213]], style: 'church' },
    { poly: [[655, 430], [720, 430], [720, 472], [655, 472]], style: 'flat', label: 'UNIVERSITÉ' },
  ],

  props: [
    { type: 'fountain', p: [521, 192], r: 2.2 },
    { type: 'statue', p: [380, 300], r: 1.6 },
    { type: 'tree', p: [190, 330] }, { type: 'tree', p: [228, 336] }, { type: 'tree', p: [210, 322] },
    { type: 'tree', p: [660, 330] }, { type: 'tree', p: [700, 350] }, { type: 'tree', p: [680, 385] }, { type: 'tree', p: [715, 322] },
    { type: 'tree', p: [650, 485] }, { type: 'tree', p: [725, 485] },
    { type: 'tree', p: [60, 60] }, { type: 'tree', p: [240, 60] }, { type: 'tree', p: [60, 155] }, { type: 'tree', p: [240, 155] },
  ],

  bollards: [
    { edge: ['OT2', 'OT3'], side: 1, from: 16, to: 102, step: 2.4, lat: 0.45 },
    { edge: ['OT1', 'OT2'], side: 1, from: 6, to: 38, step: 2.4, lat: 0.45 },
  ],

  stops: {
    gare: { name: 'Gare', edge: ['G1', 'G2'], d: 52, bay: 2.6 },
    avgare: { name: 'Avenue de la Gare', edge: ['G2', 'R'], d: 90 },
    liberte: { name: 'Liberté', edge: ['R', 'A1'], d: 66 },
    ecoles: { name: 'Écoles', edge: ['A1', 'H2'], d: 62 },
    hopital: { name: 'Hôpital', edge: ['H2', 'H1'], d: 58 },
    lamartine: { name: 'Lamartine', edge: ['G2', 'B2'], d: 70 },
    college: { name: 'Collège', edge: ['B2', 'H2'], d: 70 },
    mairie: { name: 'Mairie', edge: ['H2', 'A1'], d: 58 },
    granderue: { name: 'Grande Rue', edge: ['A1', 'OT2'], d: 58 },
    marche: { name: 'Place du Marché', edge: ['OT2', 'OT3'], d: 52 },
    universite: { name: 'Université', edge: ['ES', 'SE'], d: 50 },
    quais: { name: 'Les Quais', edge: ['S4', 'S3'], d: 58 },
    pasteur: { name: 'Pasteur', edge: ['S3', 'P1'], d: 50 },
    republique: { name: 'République', edge: ['R', 'B2'], d: 64 },
    moliere: { name: 'Square Molière', edge: ['B2', 'B1'], d: 52 },
    garenord: { name: 'Gare Nord', edge: ['B1', 'G1'], d: 84 },
    remparts: { name: 'Remparts', edge: ['B4', 'B3'], d: 48 },
    chateau: { name: 'Château', edge: ['B3', 'OT1'], d: 52 },
    portesj: { name: 'Porte Saint-Jean', edge: ['GO', 'EM'], d: 26 },
    rueest: { name: "Rue de l'Est", edge: ['EM', 'BE'], d: 80 },
    bdest: { name: 'Boulevard Est', edge: ['BE', 'B4'], d: 58 },
    bdouest: { name: 'Boulevard Ouest', edge: ['B1', 'BW'], d: 72 },
  },

  lines: [
    {
      id: 'N', color: '#8e44ad', name: 'Navette Boulevard', to: 'Boulevard Ouest', level: 1, bus: '12',
      desc: 'Ligne d’apprentissage : boulevard large, stationnement des deux côtés et un giratoire.',
      nodes: ['BE', 'B4', 'B3', 'R', 'B2', 'B1', 'BW'],
      stops: ['bdest', 'remparts', 'republique', 'moliere', 'bdouest'], kmh: 20,
    },
    {
      id: '1', color: '#e53935', name: 'Gare ↔ Hôpital', to: 'Hôpital', level: 2, bus: '18',
      desc: 'Avenues arborées et giratoire à cinq branches. Idéale pour l’articulé.',
      nodes: ['G1', 'G2', 'R', 'A1', 'H2', 'H1'],
      stops: ['gare', 'avgare', 'liberte', 'ecoles', 'hopital'], kmh: 19,
    },
    {
      id: '3', color: '#43a047', name: 'Université ↔ Gare Nord', to: 'Gare Nord', level: 3, bus: '15',
      desc: 'Quais, rues résidentielles avec stationnement et virages serrés à droite.',
      nodes: ['ES', 'SE', 'S4', 'S3', 'P1', 'B3', 'R', 'B2', 'B1', 'G1'],
      stops: ['universite', 'quais', 'pasteur', 'republique', 'moliere', 'garenord'], kmh: 19,
    },
    {
      id: '2', color: '#1e88e5', name: 'Gare ↔ Place du Marché', to: 'Place du Marché', level: 4, bus: '12',
      desc: 'Rues étroites, croisements délicats et pavés de la Grande Rue.',
      nodes: ['G1', 'G2', 'B2', 'H2', 'A1', 'OT2', 'OT3'],
      stops: ['gare', 'lamartine', 'college', 'mairie', 'granderue', 'marche'], kmh: 16,
    },
    {
      id: '4', color: '#fb8c00', name: 'Circulaire Vieille Ville', to: 'Remparts', level: 5, bus: '12',
      desc: 'Ruelles pavées, virage à angle droit et la Porte Saint-Jean : 3,60 m de large.',
      nodes: ['B4', 'B3', 'OT1', 'OT2', 'OT3', 'GI', 'GO', 'EM', 'BE', 'B4', 'B3'],
      stops: ['remparts', 'chateau', 'marche', 'portesj', 'rueest', 'remparts'], kmh: 14,
    },
  ],
};
