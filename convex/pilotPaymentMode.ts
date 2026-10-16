export type PaymentMode='razorpay_test'|'razorpay_live';
export function currentPaymentMode():PaymentMode {const value=process.env.PAYMENT_MODE;if(value===undefined||value==='razorpay_test')return 'razorpay_test';if(value==='razorpay_live')return value;throw new Error('Payment configuration unavailable');}
export function assertOrderMode(order:{paymentMode?:PaymentMode}) {if((order.paymentMode??'razorpay_test')!==currentPaymentMode())throw new Error('Payment mode mismatch. Open a new checkout with Join.');}

// Coupon and operator grants are access, never payment records or provider mode bypasses.
export function validEntitlementSource(source:string){return source==='trial'||source==='coupon'||source==='operator_test'||source===currentPaymentMode();}
