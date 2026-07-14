import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../lib/generated/prisma/client'
import { currentTierPrice, type PriceTier } from '../lib/pricing'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const days = (n: number) => new Date(Date.now() + n * 86_400_000)

async function main() {
  // Idempotent: clear in FK-safe order so re-seeding is painless.
  await prisma.payment.deleteMany()
  await prisma.supplierPayout.deleteMany()
  await prisma.commitment.deleteMany()
  await prisma.campaign.deleteMany()
  await prisma.product.deleteMany()
  await prisma.supplier.deleteMany()
  await prisma.exchangeRateSnapshot.deleteMany()
  await prisma.user.deleteMany()

  const [shenzhenTech, guangzhouMobile, huaqiangbei] = await Promise.all([
    prisma.supplier.create({
      data: {
        name: 'Shenzhen Tech Direct',
        contactPerson: 'Li Wei',
        wechatOrWhatsapp: 'wechat:li_wei_sztd',
        paymentDetails: { type: 'alipay', account: 'liwei@sztd.example' },
        notes: 'Fast on phones, slow to reply on weekends.',
      },
    }),
    prisma.supplier.create({
      data: {
        name: 'Guangzhou Mobile Wholesale',
        contactPerson: 'Chen Yu',
        wechatOrWhatsapp: 'whatsapp:+8613800000001',
        paymentDetails: { type: 'bank', bank: 'ICBC', account: '6222••••4417' },
        notes: 'Best laptop pricing at volume.',
      },
    }),
    prisma.supplier.create({
      data: {
        name: 'Huaqiangbei Accessories Co.',
        contactPerson: 'Zhao Min',
        wechatOrWhatsapp: 'wechat:hqb_accessories',
        paymentDetails: { type: 'alipay', account: 'zhaomin@hqb.example' },
        notes: 'Accessories only. Great MOQ flexibility.',
        isActive: true,
      },
    }),
  ])

  const products = await Promise.all([
    prisma.product.create({
      data: {
        name: 'Redmi Note 13 (8/256)',
        description: 'Budget flagship with 108MP camera, dual SIM.',
        category: 'PHONE',
        images: ['https://picsum.photos/seed/redmi13/600/600'],
        specs: { ram: '8GB', storage: '256GB', color: 'Midnight Black' },
        baseCostRmb: '890.00',
        supplierId: shenzhenTech.id,
      },
    }),
    prisma.product.create({
      data: {
        name: 'Infinix Note 40 Pro',
        description: 'Fast-charge phone popular across Naija markets.',
        category: 'PHONE',
        images: ['https://picsum.photos/seed/infinix40/600/600'],
        specs: { ram: '12GB', storage: '256GB', color: 'Titan Gold' },
        baseCostRmb: '1020.00',
        supplierId: shenzhenTech.id,
      },
    }),
    prisma.product.create({
      data: {
        name: 'Lenovo Tab M11',
        description: '11" tablet, great for students.',
        category: 'TABLET',
        images: ['https://picsum.photos/seed/tabm11/600/600'],
        specs: { ram: '8GB', storage: '128GB', display: '11-inch 90Hz' },
        baseCostRmb: '1150.00',
        supplierId: guangzhouMobile.id,
      },
    }),
    prisma.product.create({
      data: {
        name: 'HP Pavilion 15 (i5/16GB)',
        description: 'Everyday productivity laptop.',
        category: 'LAPTOP',
        images: ['https://picsum.photos/seed/hp15/600/600'],
        specs: { cpu: 'Intel i5-1335U', ram: '16GB', storage: '512GB SSD' },
        baseCostRmb: '3450.00',
        supplierId: guangzhouMobile.id,
      },
    }),
    prisma.product.create({
      data: {
        name: 'Anker 65W GaN Charger',
        description: 'Compact fast charger, 3 ports.',
        category: 'ACCESSORY',
        images: ['https://picsum.photos/seed/anker65/600/600'],
        specs: { wattage: '65W', ports: 'USB-C x2, USB-A x1' },
        baseCostRmb: '95.00',
        supplierId: huaqiangbei.id,
      },
    }),
    prisma.product.create({
      data: {
        name: 'Braided USB-C Cable (2m)',
        description: 'Durable 100W cable, mixed carton.',
        category: 'OTHER',
        images: ['https://picsum.photos/seed/usbc2m/600/600'],
        specs: { length: '2m', rating: '100W', packSize: '50 per carton' },
        baseCostRmb: '18.00',
        supplierId: huaqiangbei.id,
      },
    }),
  ])

  const [redmi, infinix, , hpLaptop] = products

  const buyers = await Promise.all(
    [
      { email: 'ada@example.com', phone: '+2348012345001', fullName: 'Ada Okeke', city: 'Lagos', state: 'Lagos' },
      { email: 'tunde@example.com', phone: '+2348012345002', fullName: 'Tunde Balogun', city: 'Ibadan', state: 'Oyo' },
      { email: 'chidi@example.com', phone: '+2348012345003', fullName: 'Chidi Nwosu', city: 'Abuja', state: 'FCT' },
      { email: 'zainab@example.com', phone: '+2348012345004', fullName: 'Zainab Bello', city: 'Kano', state: 'Kano' },
    ].map((data) =>
      prisma.user.create({
        data: {
          email: data.email,
          phone: data.phone,
          fullName: data.fullName,
          shippingStreet: '12 Market Road',
          shippingCity: data.city,
          shippingState: data.state,
        },
      })
    )
  )

  await prisma.exchangeRateSnapshot.create({
    data: { rmbToNgnRate: '230.5000', usdToNgnRate: '1650.0000', source: 'seed-fixture' },
  })

  // --- Campaign 1: OPEN with some commitments ---
  const redmiTiers: PriceTier[] = [
    { minUnits: 10, pricePerUnitNaira: 285000 },
    { minUnits: 50, pricePerUnitNaira: 268000 },
  ]
  const redmiCommitted = 14
  const openCampaign = await prisma.campaign.create({
    data: {
      title: 'Redmi Note 13 — March Group Buy',
      description: 'Pool 50 units to unlock the best price.',
      productId: redmi.id,
      moq: 10,
      maxUnits: 100,
      unitsCommitted: redmiCommitted,
      priceTiers: redmiTiers,
      currentTierPrice: currentTierPrice(redmiTiers, redmiCommitted).toFixed(2),
      deadline: days(12),
      status: 'OPEN',
    },
  })

  const openPrice = currentTierPrice(redmiTiers, redmiCommitted)
  const openCommitments = [
    { user: buyers[0], quantity: 8 },
    { user: buyers[1], quantity: 6 },
  ]
  for (const c of openCommitments) {
    const commitment = await prisma.commitment.create({
      data: {
        campaignId: openCampaign.id,
        userId: c.user.id,
        quantity: c.quantity,
        priceLockedInNaira: openPrice.toFixed(2),
        paymentStatus: 'PAID',
      },
    })
    await prisma.payment.create({
      data: {
        commitmentId: commitment.id,
        amountNaira: (openPrice * c.quantity).toFixed(2),
        paystackReference: `seed_ps_${commitment.id.slice(-8)}`,
        status: 'SUCCESS',
        paidAt: new Date(),
      },
    })
  }

  // --- Campaign 2: MOQ_REACHED ---
  const laptopTiers: PriceTier[] = [
    { minUnits: 5, pricePerUnitNaira: 720000 },
    { minUnits: 20, pricePerUnitNaira: 690000 },
  ]
  const laptopCommitted = 22
  const moqCampaign = await prisma.campaign.create({
    data: {
      title: 'HP Pavilion 15 — Office Bulk Order',
      description: 'MOQ hit — order going to supplier this week.',
      productId: hpLaptop.id,
      moq: 5,
      maxUnits: 40,
      unitsCommitted: laptopCommitted,
      priceTiers: laptopTiers,
      currentTierPrice: currentTierPrice(laptopTiers, laptopCommitted).toFixed(2),
      deadline: days(3),
      status: 'MOQ_REACHED',
    },
  })

  const laptopPrice = currentTierPrice(laptopTiers, laptopCommitted)
  const moqCommitment = await prisma.commitment.create({
    data: {
      campaignId: moqCampaign.id,
      userId: buyers[2].id,
      quantity: 22,
      priceLockedInNaira: laptopPrice.toFixed(2),
      paymentStatus: 'PAID',
    },
  })
  await prisma.payment.create({
    data: {
      commitmentId: moqCommitment.id,
      amountNaira: (laptopPrice * 22).toFixed(2),
      paystackReference: `seed_ps_${moqCommitment.id.slice(-8)}`,
      status: 'SUCCESS',
      paidAt: new Date(),
    },
  })
  await prisma.supplierPayout.create({
    data: {
      campaignId: moqCampaign.id,
      supplierId: guangzhouMobile.id,
      amountRmb: '75900.00',
      amountUsd: '10480.00',
      exchangeRateUsed: '230.5000',
      status: 'PENDING',
      notes: 'Awaiting supplier proforma invoice.',
    },
  })

  // --- Campaign 3: FAILED_REFUNDED (deadline passed, MOQ missed) ---
  const infinixTiers: PriceTier[] = [
    { minUnits: 15, pricePerUnitNaira: 330000 },
    { minUnits: 60, pricePerUnitNaira: 312000 },
  ]
  const infinixCommitted = 4
  const failedCampaign = await prisma.campaign.create({
    data: {
      title: 'Infinix Note 40 Pro — Feb Group Buy',
      description: 'Did not reach MOQ before deadline. Everyone refunded.',
      productId: infinix.id,
      moq: 15,
      unitsCommitted: infinixCommitted,
      priceTiers: infinixTiers,
      currentTierPrice: currentTierPrice(infinixTiers, infinixCommitted).toFixed(2),
      deadline: days(-5),
      status: 'FAILED_REFUNDED',
    },
  })
  const failedPrice = currentTierPrice(infinixTiers, infinixCommitted)
  const failedCommitment = await prisma.commitment.create({
    data: {
      campaignId: failedCampaign.id,
      userId: buyers[3].id,
      quantity: 4,
      priceLockedInNaira: failedPrice.toFixed(2),
      paymentStatus: 'REFUNDED',
    },
  })
  await prisma.payment.create({
    data: {
      commitmentId: failedCommitment.id,
      amountNaira: (failedPrice * 4).toFixed(2),
      paystackReference: `seed_ps_${failedCommitment.id.slice(-8)}`,
      status: 'REFUNDED',
      paidAt: days(-8),
    },
  })

  console.log('Seeded: 3 suppliers, 6 products, 3 campaigns (OPEN, MOQ_REACHED, FAILED_REFUNDED).')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
