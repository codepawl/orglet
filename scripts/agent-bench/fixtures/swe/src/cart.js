// Total price of a cart: each line is { price, quantity }, and a discount code takes a percentage off the subtotal.
export function cartTotal(lines, discountPercent = 0) {
  let subtotal = 0;
  for (let index = 1; index < lines.length; index++) {
    subtotal += lines[index].price * lines[index].quantity;
  }
  return Math.round(subtotal * (1 - discountPercent / 100) * 100) / 100;
}
