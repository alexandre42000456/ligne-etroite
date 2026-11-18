// Niveaux « défi » : parcours étroits au centre de formation et dans la vieille ville
const H = Math.PI / 2;

export const CHALLENGES = [
  {
    id: 'slalom', badge: 'D1', name: 'Slalom de plots', world: 'training', vehicle: '12', level: 1, color: '#26a69a',
    desc: 'Zigzaguez entre cinq plots sans en renverser : l’arrière du bus coupe chaque virage.',
    path: { pts: [[22, 40], [36, 40], [50, 36.4], [62, 40], [74, 43.6], [86, 40], [98, 36.4], [110, 40], [122, 43.6], [134, 40], [146, 36.4], [158, 40], [176, 40], [190, 40]] },
    finishBack: 10,
    obstacles: [50, 74, 98, 122, 146].map((x) => ({ type: 'cone', p: [x, 40] })).concat([{ type: 'cone', p: [178, 33] }, { type: 'cone', p: [178, 47] }]),
  },
  {
    id: 'couloir', badge: 'D2', name: 'Le couloir', world: 'training', vehicle: '12', level: 2, color: '#5c6bc0',
    desc: 'Un couloir de 5,90 m entre deux murs avec deux virages à angle droit.',
    path: { nodes: ['K0', 'K1', 'K2', 'K3'] }, finishBack: 9,
  },
  {
    id: 'depot', badge: 'D3', name: 'Marche arrière au dépôt', world: 'training', vehicle: '12', level: 2, color: '#8d6e63',
    desc: 'Garez le bus en marche arrière dans la place libre, entre deux bus, l’arrière contre le mur.',
    start: { x: 40, y: 100, th: 0 }, par: 80,
    guide: [[40, 100], [150, 100]],
    target: { x: 121.4, y: 145.5, th: -H, tol: { lat: 0.35, along: 0.6, ang: 3 } },
    validate: [[121.4, 140], [121.4, 112], [128, 102], [150, 100], [185, 100]],
    obstacles: [113.8, 117.6, 125.2, 129].map((x) => ({ type: 'parkedbus', p: [x, 139.6], th: -H, color: '#c0392b' })),
  },
  {
    id: 'epingle', badge: 'D4', name: 'L’épingle', world: 'training', vehicle: '15', level: 3, color: '#ef6c00',
    desc: 'Demi-tour complet autour d’un îlot dans une raquette à peine plus large que le bus de 15 m.',
    path: { nodes: ['H0', 'HR', 'H0'] }, finishBack: 10,
  },
  {
    id: 'porte', badge: 'D5', name: 'La herse', world: 'training', vehicle: '12', level: 3, color: '#7cb342',
    desc: 'Une porte de 3,60 m (12 cm par rétroviseur), puis un virage serré à gauche dans une ruelle.',
    path: { nodes: ['P0', 'P1', 'P2', 'P3', 'P4'] }, finishBack: 9,
  },
  {
    id: 'giratoire', badge: 'D6', name: 'Mini-giratoire', world: 'training', vehicle: '18', level: 3, color: '#ab47bc',
    desc: 'Troisième sortie d’un giratoire de 23 m avec l’articulé : l’anneau franchissable est votre allié.',
    path: { nodes: ['GW', 'GR', 'GN'] }, finishBack: 8,
  },
  {
    id: 'chicane', badge: 'D7', name: 'Chicane à potelets', world: 'training', vehicle: '18', level: 4, color: '#ec407a',
    desc: 'Quatre virages enchaînés bordés de potelets : la remorque de l’articulé doit passer aussi.',
    path: { nodes: ['Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5'] }, finishBack: 8,
  },
  {
    id: 'quai', badge: 'D8', name: 'Mise à quai', world: 'training', vehicle: 'semi', level: 4, color: '#1e88e5',
    desc: 'Reculez la semi-remorque dans le quai libre de 4 m, entre deux remorques, jusqu’au butoir.',
    start: { x: 60, y: 395, th: 0 }, par: 120,
    guide: [[60, 395], [215, 395]],
    target: { x: 154, y: 332.7, th: H, tol: { lat: 0.35, along: 0.6, ang: 3 } },
    validate: [[154, 345], [154, 372], [166, 392], [200, 396], [260, 396], [330, 396]],
    obstacles: [149, 159].map((x) => ({ type: 'trailer', p: [x, 339.4], th: H, color: '#d5d8dc' })),
  },
  {
    id: 'ruelles', badge: 'D9', name: 'Les ruelles', world: 'city', vehicle: '12', level: 4, color: '#fb8c00',
    desc: 'Rue des Moines et rue Saint-Pierre (4,2 m, sens uniques pavés) puis la Grande Rue, avec la circulation.',
    path: { nodes: ['AN', 'N3', 'OT4', 'OT2', 'A1', 'AN'] }, finishBack: 25, traffic: true,
  },
  {
    id: 'vieilleville', badge: 'D10', name: 'L’articulé en vieille ville', world: 'city', vehicle: '18', level: 5, color: '#e53935',
    desc: 'Rue du Château, Place du Marché et la Porte Saint-Jean avec 18 m de bus.',
    path: { nodes: ['B4', 'B3', 'OT1', 'OT2', 'OT3', 'GI', 'GO', 'EM', 'BE'] }, finishBack: 25, traffic: true,
  },
];
