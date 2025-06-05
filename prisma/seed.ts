import { PrismaClient, BusinessType, VerificationStatus, SubscriptionTier, ProductCondition } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

// Constants
const BUSINESS_TYPES: BusinessType[] = [BusinessType.INDIVIDUAL, BusinessType.PARTNERSHIP, BusinessType.CORPORATION, BusinessType.LLC, BusinessType.NON_PROFIT];
const VERIFICATION_STATUSES: VerificationStatus[] = [VerificationStatus.PENDING, VerificationStatus.VERIFIED, VerificationStatus.REJECTED];
const SUBSCRIPTION_TIERS: SubscriptionTier[] = [SubscriptionTier.BASIC, SubscriptionTier.PREMIUM, SubscriptionTier.PROFESSIONAL, SubscriptionTier.ENTERPRISE];
const PRODUCT_CONDITIONS: ProductCondition[] = [ProductCondition.NEW, ProductCondition.USED, ProductCondition.REFURBISHED, ProductCondition.COLLECTIBLE];

// More focused categories
const CATEGORIES = [
  { name: 'Smartphones', slug: 'smartphones' },
  { name: 'Laptops & Computers', slug: 'laptops-computers' },
  { name: 'Audio & Headphones', slug: 'audio-headphones' },
  { name: 'TVs & Displays', slug: 'tvs-displays' },
  { name: 'Cameras & Photography', slug: 'cameras-photography' },
  { name: 'Wearable Tech', slug: 'wearable-tech' },
  { name: 'Men\'s Fashion', slug: 'mens-fashion' },
  { name: 'Women\'s Fashion', slug: 'womens-fashion' },
  { name: 'Shoes & Footwear', slug: 'shoes-footwear' },
  { name: 'Accessories', slug: 'accessories' },
  { name: 'Home Appliances', slug: 'home-appliances' },
  { name: 'Gaming & Consoles', slug: 'gaming-consoles' }
];

// Product templates by category
const PRODUCT_TEMPLATES = {
  'smartphones': [
    { name: 'iPhone 15 Pro Max', price: 1099, image: 'https://fdn2.gsmarena.com/vv/pics/apple/apple-iphone-15-pro-max-1.jpg' },
    { name: 'Samsung Galaxy S23 Ultra', price: 999, image: 'https://fdn2.gsmarena.com/vv/pics/samsung/samsung-galaxy-s23-ultra-5g-1.jpg' },
    { name: 'Google Pixel 8 Pro', price: 899, image: 'https://fdn2.gsmarena.com/vv/pics/google/google-pixel-8-pro-1.jpg' },
    { name: 'Xiaomi 14 Ultra', price: 799, image: 'https://fdn2.gsmarena.com/vv/pics/xiaomi/xiaomi-14-ultra-1.jpg' },
    { name: 'OnePlus 12', price: 749, image: 'https://fdn2.gsmarena.com/vv/pics/oneplus/oneplus-12-1.jpg' },
    { name: 'Motorola Edge 50 Pro', price: 499, image: 'https://fdn2.gsmarena.com/vv/pics/motorola/motorola-edge-50-pro-1.jpg' }
  ],
  'laptops-computers': [
    { name: 'MacBook Pro 16-inch M3', price: 2499, image: 'https://photos5.appleinsider.com/gallery/54657-111045-2023-MacBook-Pro-xl.jpg' },
    { name: 'Dell XPS 15', price: 1799, image: 'https://i.dell.com/is/image/DellContent/content/dam/ss2/product-images/dell-client-products/notebooks/xps-notebooks/xps-15-9530/media-gallery/black/notebook-xps-15-9530-black-gallery-1.psd?fmt=png-alpha&wid=5000&hei=2843' },
    { name: 'HP Spectre x360', price: 1399, image: 'https://ssl-product-images.www8-hp.com/digmedialib/prodimg/lowres/c08040326.png' },
    { name: 'Lenovo ThinkPad X1 Carbon', price: 1499, image: 'https://p1-ofp.static.pub/medias/bWFzdGVyfHJvb3R8MjYwNDczfGltYWdlL3BuZ3xoZWMvaGFjLzE1MDUzODUyNDIxMTUwLnBuZ3w0OTVjMTY0ZmJkYTUwNTZkZmFkNjk3MmI2MjVmMWVmYTQ0MjNmYzVlMTFkZTk3ZDkxOGMzYTE4ZmYxZTc3YzZh/lenovo-laptop-thinkpad-x1-carbon-gen-10-hero.png' },
    { name: 'ASUS ROG Zephyrus G15', price: 1699, image: 'https://dlcdnwebimgs.asus.com/gain/BF7E92F0-ED9F-46B7-AAD0-9A664389BFCE/w1000/h732' },
    { name: 'Acer Predator Helios 16', price: 1599, image: 'https://static-ecapac.acer.com/media/catalog/product/p/h/ph16-71_ksp03_black_win11_01_4.jpg' }
  ],
  'audio-headphones': [
    { name: 'Sony WH-1000XM5', price: 399, image: 'https://img.sony.co.th/image/5ff52121e44b8d7304b24aa4c29b3f92?fmt=png-alpha&wid=720' },
    { name: 'Bose QuietComfort Ultra', price: 429, image: 'https://assets.bose.com/content/dam/cloudassets/Bose_DAM/Web/consumer_electronics/global/products/headphones/qc_ultra_headphones/product_silo_images/QCU_HP_BLK_hero.png/jcr:content/renditions/cq5dam.web.600.600.png' },
    { name: 'Apple AirPods Pro 2', price: 249, image: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MQD83?wid=1144&hei=1144&fmt=jpeg&qlt=90&.v=1660803972361' },
    { name: 'Samsung Galaxy Buds3 Pro', price: 199, image: 'https://images.samsung.com/is/image/samsung/p6pim/levant/galaxy-s23/gallery/levant-galaxy-buds2-pro-r510-sm-r510nlvamea-534127965?$1300_1038_PNG$' }
  ],
  'tvs-displays': [
    { name: 'Samsung Neo QLED 8K 75"', price: 4999, image: 'https://images.samsung.com/is/image/samsung/p6pim/ae/feature/others/ae-feature-experience-the-real-8k-resolution-536265756?$FB_TYPE_A_MO_JPG$' },
    { name: 'LG OLED C4 65"', price: 2499, image: 'https://www.lg.com/uk/images/tvs/md07554916/gallery/medium05.jpg' },
    { name: 'Sony Bravia XR A95L 55"', price: 2799, image: 'https://aboutpix.com/wp-content/uploads/2023/08/Sony-Bravia-XR-A95L-QD-OLED.jpg' }
  ],
  'mens-fashion': [
    { name: 'Premium Cotton T-Shirt', price: 29.99, image: 'https://img01.ztat.net/article/spp-media-p1/7fee55eaee0a3113a25cb4574d96946c/5c7d68d1fee04f8aa64dfcc0c40d0bc1.jpg' },
    { name: 'Slim Fit Chino Pants', price: 59.99, image: 'https://img01.ztat.net/article/spp-media-p1/33bccadf2b2b36ad857690911c495e9b/6d8a55de1fbf4e42a01c2c6e68bb2d7c.jpg' },
    { name: 'Classic Oxford Shirt', price: 49.99, image: 'https://img01.ztat.net/article/spp-media-p1/b84642f1c2ac3c57832d6b53e9b4b246/8ab325f296cd45b5b188dd8f8c0319b4.jpg' },
    { name: 'Denim Jacket', price: 89.99, image: 'https://img01.ztat.net/article/spp-media-p1/33d2195ef3493e318a3e7387d4f4ab58/ef1e8a9f0044449d9b4107ef8ef6e1cc.jpg' }
  ],
  'womens-fashion': [
    { name: 'Floral Print Dress', price: 69.99, image: 'https://img01.ztat.net/article/spp-media-p1/9e49579595144c9eb98d80e65278ff84/50048a28feae4495a0deb997a7c92a8b.jpg' },
    { name: 'High-Waisted Jeans', price: 79.99, image: 'https://img01.ztat.net/article/spp-media-p1/5ba8113fe94832c9ae68f11c75bd9a36/b75bcd142dbd477ea523f10812f7c301.jpg' },
    { name: 'Cashmere Sweater', price: 129.99, image: 'https://img01.ztat.net/article/spp-media-p1/d391f90be278364db6cd3cb1140939cd/3ce5ab6c542140239e9ee3306622704a.jpg' },
    { name: 'Leather Handbag', price: 159.99, image: 'https://img01.ztat.net/article/spp-media-p1/b76f2c2e6df63edcac3c5b5a479b7fb8/c86341a049914401886dcf7b5cbc83fb.jpg' }
  ],
  'shoes-footwear': [
    { name: 'Nike Air Max 270', price: 150, image: 'https://static.nike.com/a/images/t_PDP_1280_v1/f_auto,q_auto:eco/402eaa28-c5dd-4260-bfa9-9524833ee4ef/air-max-270-mens-shoes-KkLcGR.png' },
    { name: 'Adidas Ultraboost', price: 180, image: 'https://assets.adidas.com/images/h_840,f_auto,q_auto,fl_lossy,c_fill,g_auto/69cbc73d0cb846889f89aed801351886_9366/Ultraboost_Light_Shoes_Black_HQ6351_01_standard.jpg' },
    { name: 'Puma RS-X', price: 110, image: 'https://images.puma.com/image/upload/f_auto,q_auto,b_rgb:fafafa,w_2000,h_2000/global/369579/05/sv01/fnd/PNA/fmt/png/RS-X-Toys-Sneakers' }
  ],
  'wearable-tech': [
    { name: 'Apple Watch Series 9', price: 399, image: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MT653ref_VW_34FR+watch-case-45-aluminum-midnight-nc-s9_VW_34FR_WF_CO_GEO_US?wid=1400&hei=1400&trim=1%2C0&fmt=p-jpg&qlt=95&.v=1693335824726' },
    { name: 'Samsung Galaxy Watch6 Classic', price: 399, image: 'https://images.samsung.com/is/image/samsung/p6pim/de/2307/gallery/de-galaxy-watch6-classic-470389-sm-r960nzsaeub-536818577?$650_519_PNG$' },
    { name: 'Fitbit Sense 2', price: 299, image: 'https://www.fitbit.com/global/content/dam/fitbit/global/pdp/devices/sense-2/hero-static/shadow-black/sense2-shadow-black-device-3qt.png' }
  ],
  'gaming-consoles': [
    { name: 'PlayStation 5', price: 499, image: 'https://gmedia.playstation.com/is/image/SIEPDC/ps5-product-thumbnail-01-en-14sep21?$facebook$' },
    { name: 'Xbox Series X', price: 499, image: 'https://img-prod-cms-rt-microsoft-com.akamaized.net/cms/api/am/imageFileData/RE4mRni?ver=a707' },
    { name: 'Nintendo Switch OLED', price: 349, image: 'https://assets.nintendo.com/image/upload/ar_16:9,b_auto:border,c_lpad/b_white/f_auto/q_auto/dpr_auto/c_scale,w_800/v1/ncom/en_US/switch/site-design-update/hardware/switch/nintendo-switch-oled-model-white-set/gallery/image03?_a=AJADJWI0' }
  ],
  'home-appliances': [
    { name: 'Dyson V15 Detect Vacuum', price: 699, image: 'https://dyson-h.assetsadobe2.com/is/image/content/dam/dyson/images/products/primary/393977-01.png?fmt=png-alpha&scl=1&fmt=png-alpha' },
    { name: 'KitchenAid Stand Mixer', price: 399, image: 'https://www.kitchenaid.com/content/dam/global/kitchenaid/countertop-appliance/portable/images/hero-KSM150PSER.jpg' },
    { name: 'Ninja Foodi Multi-Cooker', price: 249, image: 'https://pisces.bbystatic.com/image2/BestBuy_US/images/products/6428/6428927_sd.jpg' }
  ],
  'cameras-photography': [
    { name: 'Canon EOS R6 Mark II', price: 2499, image: 'https://www.canon.ie/media/eos_r6_mkii_rf24-105_f4l_front_slant_down-800x800_tcm24-2461361.png' },
    { name: 'Sony Alpha a7 IV', price: 2499, image: 'https://d1iskralo6sta3.cloudfront.net/media/catalog/product/cache/c1a873f193d3a97b97e2e4cbb973cf5b/i/l/ilce-7m4_1.jpg' },
    { name: 'Nikon Z8', price: 3999, image: 'https://cdn-4.nikon-cdn.com/e/Q5NM96RZZo-YRYNeYvAi9aeqFMY3fvEk2-Z6uQmGcOsrFnDcARNUL91sxHjRLJnVtG-Xmb1DXpj0FM7Lrjw=/Views/2023-MKT-153-Z-8-front.png' }
  ],
  'accessories': [
    { name: 'Designer Sunglasses', price: 159, image: 'https://img01.ztat.net/article/spp-media-p1/c1047d96bfb93f0cbc98fc6d3c07bc10/8ffe5417e0654089b81e6551c35ba644.jpg' },
    { name: 'Leather Wallet', price: 79, image: 'https://img01.ztat.net/article/spp-media-p1/bd98cd1888034b18a5c3a817bc4d4788/a77afc1bbec04c3a8dfb1fbce63adcb8.jpg' },
    { name: 'Luxury Watch', price: 599, image: 'https://www.tissotwatches.com/media/catalog/product/T/1/T131.617.36.032.00_R.png' }
  ]
};

// Helper functions
const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;
const randomItem = <T>(array: T[]): T => array[Math.floor(Math.random() * array.length)];
const createSlug = (text: string): string => {
  // Add a random string to ensure uniqueness
  return text.toLowerCase()
    .replace(/[^\w ]+/g, '')
    .replace(/ +/g, '-') + 
    '-' + faker.string.alphanumeric(6).toLowerCase();
};

// Get random product from a category
const getRandomProduct = (category: string) => {
  const categoryProducts = PRODUCT_TEMPLATES[category as keyof typeof PRODUCT_TEMPLATES] || [];
  if (categoryProducts.length === 0) {
    // Fallback if category doesn't exist
    const allProducts = Object.values(PRODUCT_TEMPLATES).flat();
    return randomItem(allProducts);
  }
  return randomItem(categoryProducts);
};

async function main() {
  console.log('Starting database seeding...');
  
  // Create categories
  console.log('Creating categories...');
  const createdCategories = [];
  for (const category of CATEGORIES) {
    const createdCategory = await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: {
        name: category.name,
        slug: category.slug,
        description: `Products in the ${category.name} category`,
        isActive: true,
        isFeatured: Math.random() > 0.7,
      },
    });
    createdCategories.push(createdCategory);
  }
  
  // Create vendors and products
  console.log('Creating vendors and products...');
  const totalVendors = 200;
  const productsPerVendor = 3;
  
  for (let i = 0; i < totalVendors; i++) {
    // Create user for vendor
    const userEmail = faker.internet.email();
    const userFirstName = faker.person.firstName();
    const userLastName = faker.person.lastName();
    
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        password: faker.internet.password(),
        firstName: userFirstName,
        lastName: userLastName,
        name: `${userFirstName} ${userLastName}`,
        phone: faker.phone.number(),
        isVerified: true,
        role: 'VENDOR',
        profileImageUrl: faker.image.avatar(),
        biography: faker.person.bio(),
        gender: randomItem(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']),
        dateOfBirth: faker.date.past({ years: 30 }),
        accountStatus: 'ACTIVE',
      },
    });
    
    // Create vendor profile
    const storeName = faker.company.name();
    const storeSlug = createSlug(storeName);
    
    // Choose a vendor focus category - this will influence the products they sell
    const vendorFocusCategory = randomItem(CATEGORIES).slug;
    
    const vendor = await prisma.vendor.create({
      data: {
        userId: user.id,
        storeName: storeName,
        slug: storeSlug,
        description: faker.company.catchPhrase(),
        shortDescription: faker.company.buzzPhrase(),
        logo: 'https://placehold.co/400x400/png?text=' + encodeURIComponent(storeName.substring(0, 1)),
        banner: 'https://placehold.co/1200x300/png?text=' + encodeURIComponent(storeName),
        coverImage: 'https://placehold.co/1200x600/png?text=' + encodeURIComponent(storeName),
        featuredImages: [
          'https://placehold.co/800x600/png?text=' + encodeURIComponent(`${storeName} Featured 1`),
          'https://placehold.co/800x600/png?text=' + encodeURIComponent(`${storeName} Featured 2`)
        ],
        contactEmail: faker.internet.email(),
        contactPhone: faker.phone.number(),
        businessAddress: {
          street: faker.location.street(),
          city: faker.location.city(),
          state: faker.location.state(),
          country: faker.location.country(),
          postalCode: faker.location.zipCode()
        },
        taxIdentification: faker.finance.accountNumber(),
        businessType: randomItem(BUSINESS_TYPES),
        foundedYear: randomInt(1990, 2023),
        verificationStatus: randomItem(VERIFICATION_STATUSES),
        isActive: true,
        isPopular: Math.random() > 0.8,
        isFeatured: Math.random() > 0.8,
        avgRating: faker.number.float({ min: 3.5, max: 5, fractionDigits: 1 }),
        totalRatings: randomInt(5, 500),
        totalSales: randomInt(10, 2000),
        commissionRate: faker.number.float({ min: 5, max: 15, fractionDigits: 1 }),
        processingTime: randomItem(['1-2 business days', '2-3 business days', '3-5 business days']),
        stripeAccountId: faker.string.alphanumeric(20),
        subscription: randomItem(SUBSCRIPTION_TIERS),
        
        // Create shipping methods
        shippingMethods: {
          create: [
            {
              name: 'Standard Shipping',
              description: 'Delivery within 5-7 business days',
              basePrice: faker.number.float({ min: 5, max: 15 }),
              estimatedDays: '5-7 days',
              isActive: true,
              supportedRegions: ['North America', 'Europe']
            },
            {
              name: 'Express Shipping',
              description: 'Delivery within 1-2 business days',
              basePrice: faker.number.float({ min: 15, max: 30 }),
              estimatedDays: '1-2 days',
              isActive: true,
              supportedRegions: ['North America']
            }
          ]
        }
      }
    });
    
    // Find related categories based on vendor focus
    let relatedCategories = createdCategories.filter(c => 
      c.slug === vendorFocusCategory || 
      Math.random() > 0.7 // 30% chance to include other categories
    );
    
    // Ensure we have at least one category
    if (relatedCategories.length === 0) {
      relatedCategories = [randomItem(createdCategories)];
    }
    
    // Create products for each vendor - exactly 3 products per vendor
    for (let j = 0; j < productsPerVendor; j++) {
      // Select a category for this product
      const productCategory = randomItem(relatedCategories);
      
      // Get a random product template from this category
      const productTemplate = getRandomProduct(productCategory.slug);
      
      // Add some variation to the name to make it unique
      const brandPrefix = Math.random() > 0.5 ? `${storeName} ` : '';
      const suffix = Math.random() > 0.7 ? ` ${faker.commerce.productAdjective()}` : '';
      const variantName = Math.random() > 0.6 ? ` ${faker.color.human()}` : '';
      
      const productName = `${brandPrefix}${productTemplate.name}${suffix}${variantName}`;
      const productSlug = createSlug(productName);
      
      // Adjust price with some randomness
      const priceVariation = Math.random() * 0.3 - 0.15; // -15% to +15%
      const basePrice = productTemplate.price * (1 + priceVariation);
      const comparePrice = Math.random() > 0.7 ? basePrice * 1.2 : null;
      
      // Create product
      const product = await prisma.product.create({
        data: {
          vendorId: vendor.id,
          name: productName,
          slug: productSlug,
          description: faker.commerce.productDescription(),
          shortDescription: faker.lorem.paragraph(),
          price: basePrice,
          comparePrice: comparePrice,
          costPrice: basePrice * 0.6,
          wholesalePrice: basePrice * 0.8,
          wholesaleMinQty: randomInt(5, 20),
          sku: faker.string.alphanumeric(8).toUpperCase(),
          inventory: randomInt(5, 100),
          lowStockThreshold: 5,
          weight: faker.number.float({ min: 0.1, max: 10 }),
          dimensions: {
            length: faker.number.float({ min: 5, max: 50 }),
            width: faker.number.float({ min: 5, max: 50 }),
            height: faker.number.float({ min: 5, max: 50 })
          },
          isPublished: true,
          isDigital: false,
          hasVariants: Math.random() > 0.7,
          isFeatured: Math.random() > 0.8,
          isOnSale: Math.random() > 0.7,
          condition: randomItem(PRODUCT_CONDITIONS),
          warrantyInfo: randomItem(['30 Days', '90 Days', '1 Year', null]),
          
          // Create product images with real product images
          images: {
            create: [
              {
                url: productTemplate.image, // Use the real product image
                isMain: true,
                position: 0
              },
              {
                url: Math.random() > 0.5 ? productTemplate.image : 'https://placehold.co/600x400/png?text=' + encodeURIComponent(productName),
                isMain: false,
                position: 1
              }
            ]
          },
          
          // Create specifications
          specifications: {
            create: [
              {
                name: 'Color',
                value: faker.color.human(),
                isFilterable: true
              },
              {
                name: 'Material',
                value: faker.commerce.productMaterial(),
                isFilterable: true
              },
              {
                name: 'Brand',
                value: productName.split(' ')[0],
                isFilterable: true
              }
            ]
          }
        }
      });
      
      // Add product to categories
      await prisma.categoriesOnProducts.create({
        data: {
          productId: product.id,
          categoryId: productCategory.id,
          isPrimary: true
        }
      });
      
      // Add to secondary category if relevant
      if (relatedCategories.length > 1 && Math.random() > 0.5) {
        const secondaryCategories = relatedCategories.filter(c => c.id !== productCategory.id);
        if (secondaryCategories.length > 0) {
          const secondaryCategory = randomItem(secondaryCategories);
          await prisma.categoriesOnProducts.create({
            data: {
              productId: product.id,
              categoryId: secondaryCategory.id,
              isPrimary: false
            }
          });
        }
      }
      
      // Create variants if product has them
      if (product.hasVariants) {
        const variantTypes = productCategory.slug.includes('fashion') || productCategory.slug.includes('clothing') 
          ? ['Color', 'Size'] 
          : ['Color', 'Storage', 'Configuration'];
        
        const variantValues = {
          Color: ['Black', 'White', 'Red', 'Blue', 'Silver', 'Gold', 'Gray'],
          Size: ['S', 'M', 'L', 'XL'],
          Storage: ['128GB', '256GB', '512GB', '1TB'],
          Configuration: ['Standard', 'Deluxe', 'Premium', 'Professional']
        };
        
        // Create 3 variants
        for (let k = 0; k < 3; k++) {
          const type1 = variantTypes[0];
          const type2 = variantTypes.length > 1 ? variantTypes[1] : variantTypes[0];
          
          const value1 = variantValues[type1 as keyof typeof variantValues][k % variantValues[type1 as keyof typeof variantValues].length];
          const value2 = variantValues[type2 as keyof typeof variantValues][k % variantValues[type2 as keyof typeof variantValues].length];
          
          await prisma.productVariant.create({
            data: {
              productId: product.id,
              name: `${value1} / ${value2}`,
              options: [
                { name: type1, value: value1 },
                { name: type2, value: value2 }
              ],
              price: basePrice + (k * 10),
              inventory: randomInt(1, 30),
              sku: `${product.sku}-${k+1}`,
              isDefault: k === 0
            }
          });
        }
      }
    }
    
    // Log progress
    if ((i + 1) % 20 === 0 || i === totalVendors - 1) {
      console.log(`Created ${i + 1}/${totalVendors} vendors with products`);
    }
  }
  
  console.log('Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 