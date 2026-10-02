// wrangler.json maps **/axe.min.js to a Text module, so importing it yields the source as a string.
declare module "*.min.js" {
  const source: string;
  export default source;
}
