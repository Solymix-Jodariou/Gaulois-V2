/**
 * Le fil d'actualité annonce « X a pris … à Y » : un jeu ne doit pas plaisanter sur un lieu
 * en guerre ou endeuillé. Ces villes laissent la place à un nom géographique neutre.
 * Clé : le nom dans Natural Earth. Valeur : le nom affiché dans le jeu.
 *
 * Liste établie le 5 novembre 2026, à relire par le clan : la carte peut se régénérer
 * tant qu'elle n'a pas été mise en ligne, et ses territoires gardent leurs numéros.
 */
export const NAME_OVERRIDES: Readonly<Record<string, string>> = {
  // Ukraine et frontière russe.
  Kiev: "Plaine du Dniepr",
  Kharkiv: "Steppe pontique",
  Odessa: "Rivages de la mer Noire",
  "Rostov-sur-le-Don": "Bas-Don",
  Voronej: "Haut-Don",
  // Proche-Orient.
  "Tel Aviv": "Levant",
  Alep: "Croissant fertile",
  Mossoul: "Haut-Tigre",
  Bagdad: "Mésopotamie",
  // Yémen.
  Aden: "Golfe d'Aden",
  Sanaa: "Hauts plateaux d'Arabie",
  "Al Mukalla": "Hadramaout",
  // Soudan et Soudan du Sud.
  Nyala: "Sahel oriental",
  Kosti: "Nil Blanc",
  "El Fasher": "Sahara oriental",
  Khartoum: "Confluent du Nil",
  Kassala: "Piémont éthiopien",
  Chendi: "Désert de Nubie",
  "Port-Soudan": "Mer Rouge occidentale",
  Wau: "Bahr el-Ghazal",
  // Corne de l'Afrique.
  Mogadiscio: "Côte du Benadir",
  Kismaayo: "Côte du Jubba",
  "Gaal Kacyo": "Corne de l'Afrique",
  Erigavo: "Golfe de Berbera",
  // Birmanie.
  Naypyidaw: "Vallée de l'Irrawaddy",
  Mandalay: "Haute-Birmanie",
  // Grands Lacs et Sahel.
  Bukavu: "Grands Lacs",
  "Aguel'hoc": "Adrar des Ifoghas",
  Bamako: "Delta intérieur du Niger",
  Ouagadougou: "Boucle du Niger",
  // Afghanistan.
  Kaboul: "Hindou Kouch",
  Kandahâr: "Désert du Registan",
  // Lieux politiquement disputés.
  Taipei: "Île de Formose",
  Pyongyang: "Monts Myohyang",
  Pusan: "Sud de la Corée",
  // Libellés maladroits de la source.
  "continent australien": "Terre d'Arnhem",
  "préfecture de Qamdo": "Qamdo",
  "ville-préfecture de Xigazê": "Xigazê",
  "Xian de Yarkand": "Yarkand",
  "Hyderâbâd": "Sindh",
  "Grand Sudbury": "Sudbury",
  "Knud Rasmussen": "Terre de Knud Rasmussen",
  Nord: "Nord du Groenland",
  "île Victoria": "Île Victoria",
  "désert Libyque": "Désert Libyque",
  "plateau de Mongolie": "Plateau de Mongolie",
  "plateau des Guyanes": "Plateau des Guyanes",
  Asuncion: "Asunción",
};
