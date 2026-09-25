/**
 * Small bundled list of common English words used by the local "word match"
 * heuristic. Deliberately compact; this is a hint, not a dictionary.
 */
export const COMMON_WORDS: readonly string[] = (
  "a able about above access account act action active ad add address advice after again age agency air all also " +
  "am an and animal any app apple apps area arm art ask at auto away baby back bad bag bake baker bank bar base " +
  "bath be beach bean bear beauty bed bee beer before best bet better big bike bill bird bit black blog blue board " +
  "boat body book boot box boy brand bread break bright bring british build builder building bus business buy by " +
  "cafe cake call camp can car card care career carpet cars case cash cat cater cell centre chair change charity " +
  "cheap check chef child city claim class clean clear click clinic clock close cloud club coach coast code coffee " +
  "cold college colour come comfort company computer consult cook cool copy corner cost cottage country course " +
  "cover craft credit cross cup cut cycle daily dance data date day deal dental design desk dev dial diet digital " +
  "direct doc dog door down dream dress drink drive driver drop dry duck early earth east easy eat eco edge " +
  "electric energy engine england estate event ever every expert express eye face fact fair family farm fashion " +
  "fast father feed field film finance find fine fire first fish fit fix flat fleet floor flower fly food foot " +
  "for forest form free fresh friend from front fruit fuel fun fund furniture game garage garden gas gate gear " +
  "get gift girl give glass go gold golf good green grill group grow guide gym hair half hall hand happy hard " +
  "hat have health heart heat help her here hero high hill hire his hold holiday home homes horse host hot hotel " +
  "house hub ice idea in info ink insure insurance is it item jet job jobs join joy just keep key kid kids kind " +
  "king kit kitchen lab land large last law lawn lead learn leather legal lens let life light line link lion list " +
  "little live loan local lock logo london long look lost love low luck lux machine made magic mail main make man " +
  "manager map market mart master me meal media medical meet men metal mind mobile money moon more mortgage " +
  "mother motor move movie music my name nation natural nature net new news next nice night north note now nurse " +
  "office oil old on one online open or order organic out outdoor over own pack page paint pan paper park part " +
  "party pass path pay peace pen people pet phone photo pick pie pink pizza place plan plant play plus pod point " +
  "pool pop port post power press price pro property pub pure quick race radio rail rain range rate re real red " +
  "rent repair rest right ring road rock roof room rose round royal run safe sale sales salon save school sea " +
  "search secure see sell send service services set shop shoe short show sign simple site skin sky smart smile " +
  "snap so social soft solar solution sound south space spa sport spot square staff star start stay steel step " +
  "stock stone store street studio style sun super supply sure sweet system table take talk tax taxi tea team " +
  "tech test the thing think time tip to today tool top tour town toy trade train travel tree trip true trust " +
  "tv uk under union unit up urban use van vet view village vision visit wall walk war watch water way web wed " +
  "wedding well west wheel white wide wild win window wine wood word work world yard year yes yoga you young zone"
)
  .split(" ")
  .filter((word) => word.length > 0);
