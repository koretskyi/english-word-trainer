// Starter A1 decks. English continues to use the full built-in SENTENCES collection.
const deck = (lang, rows) => rows.map(([id, russian, russianWord, englishTemplate, word]) => ({
  id: `${lang}_${id}`, level: "A1", russian, russianWord, englishTemplate, word
}));

export const LANGUAGE_SENTENCES = {
  de: deck("de", [
    ["001","Я ем яблоко каждый день.","яблоко","Ich esse jeden Tag einen {word}.","Apfel"],
    ["002","На столе лежит банан.","банан","Auf dem Tisch liegt eine {word}.","Banane"],
    ["003","Мне нужен свежий хлеб.","хлеб","Ich brauche frisches {word}.","Brot"],
    ["004","Можно мне стакан воды?","вода","Kann ich ein Glas {word} haben?","Wasser"],
    ["005","Я пью кофе по утрам.","кофе","Ich trinke morgens {word}.","Kaffee"],
    ["006","Чай уже готов.","чай","Der {word} ist fertig.","Tee"],
    ["007","В холодильнике есть молоко.","молоко","Es gibt {word} im Kühlschrank.","Milch"],
    ["008","Я люблю сыр.","сыр","Ich mag {word}.","Käse"],
    ["009","На завтрак я съел яйцо.","яйцо","Ich habe ein {word} zum Frühstück gegessen.","Ei"],
    ["010","Мы едим рис на ужин.","рис","Wir essen {word} zum Abendessen.","Reis"],
    ["011","Мой дом находится рядом с парком.","дом","Mein {word} ist in der Nähe des Parks.","Haus"],
    ["012","Моя комната очень маленькая.","комната","Mein {word} ist sehr klein.","Zimmer"],
    ["013","Мама готовит на кухне.","кухня","Mama kocht in der {word}.","Küche"],
    ["014","Пожалуйста, закрой дверь.","дверь","Bitte schließ die {word}.","Tür"],
    ["015","Я открыл окно.","окно","Ich habe das {word} geöffnet.","Fenster"],
    ["016","Ключ лежит на столе.","стол","Der Schlüssel liegt auf dem {word}.","Tisch"],
    ["017","Пожалуйста, сядь на стул.","стул","Bitte setz dich auf den {word}.","Stuhl"],
    ["018","Я читаю интересную книгу.","книга","Ich lese ein interessantes {word}.","Buch"],
    ["019","Мой телефон разрядился.","телефон","Mein {word} ist leer.","Handy"],
    ["020","Мой друг живёт в Дублине.","друг","Mein {word} lebt in Dublin.","Freund"]
  ]),
  fr: deck("fr", [
    ["001","Я ем яблоко каждый день.","яблоко","Je mange une {word} chaque jour.","pomme"],
    ["002","На столе лежит банан.","банан","Il y a une {word} sur la table.","banane"],
    ["003","Мне нужен свежий хлеб.","хлеб","J'ai besoin de {word} frais.","pain"],
    ["004","Можно мне стакан воды?","вода","Puis-je avoir un verre d'{word} ?","eau"],
    ["005","Я пью кофе по утрам.","кофе","Je bois du {word} le matin.","café"],
    ["006","Чай уже готов.","чай","Le {word} est prêt.","thé"],
    ["007","В холодильнике есть молоко.","молоко","Il y a du {word} dans le réfrigérateur.","lait"],
    ["008","Я люблю сыр.","сыр","J'aime le {word}.","fromage"],
    ["009","На завтрак я съел яйцо.","яйцо","J'ai mangé un {word} au petit-déjeuner.","œuf"],
    ["010","Мы едим рис на ужин.","рис","Nous mangeons du {word} au dîner.","riz"],
    ["011","Мой дом находится рядом с парком.","дом","Ma {word} est près du parc.","maison"],
    ["012","Моя комната очень маленькая.","комната","Ma {word} est très petite.","chambre"],
    ["013","Мама готовит на кухне.","кухня","Maman cuisine dans la {word}.","cuisine"],
    ["014","Пожалуйста, закрой дверь.","дверь","Ferme la {word}, s'il te plaît.","porte"],
    ["015","Я открыл окно.","окно","J'ai ouvert la {word}.","fenêtre"],
    ["016","Ключ лежит на столе.","стол","La clé est sur la {word}.","table"],
    ["017","Пожалуйста, сядь на стул.","стул","Assieds-toi sur la {word}, s'il te plaît.","chaise"],
    ["018","Я читаю интересную книгу.","книга","Je lis un {word} intéressant.","livre"],
    ["019","Мой телефон разрядился.","телефон","Mon {word} n'a plus de batterie.","téléphone"],
    ["020","Мой друг живёт в Дублине.","друг","Mon {word} habite à Dublin.","ami"]
  ]),
  is: deck("is", [
    ["001","Я ем яблоко каждый день.","яблоко","Ég borða {word} á hverjum degi.","epli"],
    ["002","На столе лежит банан.","банан","Það er {word} á borðinu.","banani"],
    ["003","Мне нужен свежий хлеб.","хлеб","Ég þarf ferskt {word}.","brauð"],
    ["004","Можно мне стакан воды?","вода","Má ég fá glas af {word}?","vatni"],
    ["005","Я пью кофе по утрам.","кофе","Ég drekk {word} á morgnana.","kaffi"],
    ["006","Чай уже готов.","чай","{word} er tilbúið.","te"],
    ["007","В холодильнике есть молоко.","молоко","Það er {word} í ísskápnum.","mjólk"],
    ["008","Я люблю сыр.","сыр","Mér finnst {word} gott.","ostur"],
    ["009","На завтрак я съел яйцо.","яйцо","Ég borðaði {word} í morgunmat.","egg"],
    ["010","Мы едим рис на ужин.","рис","Við borðum {word} í kvöldmat.","hrísgrjón"],
    ["011","Мой дом находится рядом с парком.","дом","{word} mitt er nálægt garðinum.","hús"],
    ["012","Моя комната очень маленькая.","комната","{word} mitt er mjög lítið.","herbergi"],
    ["013","Мама готовит на кухне.","кухня","Mamma eldar í {word}.","eldhúsi"],
    ["014","Пожалуйста, закрой дверь.","дверь","Vinsamlegast lokaðu {word}.","hurðinni"],
    ["015","Я открыл окно.","окно","Ég opnaði {word}.","gluggann"],
    ["016","Ключ лежит на столе.","стол","Lykillinn er á {word}.","borðinu"],
    ["017","Пожалуйста, сядь на стул.","стул","Vinsamlegast sestu á {word}.","stólinn"],
    ["018","Я читаю интересную книгу.","книга","Ég er að lesa áhugaverða {word}.","bók"],
    ["019","Мой телефон разрядился.","телефон","{word} minn er rafmagnslaus.","sími"],
    ["020","Мой друг живёт в Дублине.","друг","{word} minn býr í Dublin.","vinur"]
  ])
};
