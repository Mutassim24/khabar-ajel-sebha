const categories=[
 ['الشواحن','⚡','شواحن سريعة وأصلية وتجارية'],['الكيابل','🔌','كيابل شحن وبيانات'],['الجرابات','📱','جرابات لمختلف الموديلات'],['الحمايات','🛡️','حماية شاشة وعدسات'],['السماعات','🎧','سماعات بلوتوث وسلكية'],['الباور بانك','🔋','بطاريات متنقلة'],['الساعات الذكية','⌚','ساعات وأساور'],['إكسسوارات السيارات','🚗','حوامل وشواحن سيارات'],['التصوير','📸','ستاندات وإضاءة'],['الألعاب','🎮','ملحقات ألعاب الهاتف'],['أدوات الصيانة','🧰','معدات وأدوات فنيين'],['قطع غيار الهواتف','🔧','شاشات وبطاريات وقطع']
];
const products=[
 {id:1,name:'شاحن سريع Type-C بقوة 25W',cat:'الشواحن',price:45,wholesale:38,emoji:'🔌',tag:'الأكثر طلباً',brand:'متنوع',stock:24},
 {id:2,name:'كيبل Type-C للشحن السريع',cat:'الكيابل',price:15,wholesale:10,emoji:'〰️',tag:'',brand:'متنوع',stock:50},
 {id:3,name:'جراب حماية شفاف للهاتف',cat:'الجرابات',price:12,wholesale:8,emoji:'📱',tag:'جديد',brand:'متنوع',stock:30},
 {id:4,name:'حماية شاشة زجاج 9D',cat:'الحمايات',price:10,wholesale:6,emoji:'🛡️',tag:'',brand:'متنوع',stock:40},
 {id:5,name:'سماعة بلوتوث TWS',cat:'السماعات',price:65,wholesale:52,emoji:'🎧',tag:'عرض',brand:'متنوع',stock:12},
 {id:6,name:'باور بانك 10000mAh',cat:'الباور بانك',price:85,wholesale:70,emoji:'🔋',tag:'',brand:'متنوع',stock:10},
 {id:7,name:'حامل هاتف للسيارة',cat:'إكسسوارات السيارات',price:25,wholesale:18,emoji:'🚗',tag:'',brand:'متنوع',stock:18},
 {id:8,name:'ساعة ذكية مع سوار',cat:'الساعات الذكية',price:120,wholesale:98,emoji:'⌚',tag:'جديد',brand:'متنوع',stock:8},
 {id:9,name:'Ring Light للتصوير',cat:'التصوير',price:55,wholesale:45,emoji:'💡',tag:'',brand:'متنوع',stock:9},
 {id:10,name:'أزرار ألعاب PUBG للهاتف',cat:'الألعاب',price:20,wholesale:14,emoji:'🎮',tag:'',brand:'متنوع',stock:20},
 {id:11,name:'طقم مفكات صيانة الهاتف',cat:'أدوات الصيانة',price:35,wholesale:27,emoji:'🧰',tag:'',brand:'متنوع',stock:6},
 {id:12,name:'بطارية هاتف (حسب الموديل)',cat:'قطع غيار الهواتف',price:75,wholesale:60,emoji:'🔧',tag:'',brand:'متنوع',stock:5}
];
let activeCategory='الكل',searchTerm='',favorites=JSON.parse(localStorage.getItem('mw_favs')||'[]'),cart=JSON.parse(localStorage.getItem('mw_cart')||'[]'),favoritesOnly=false;
const $=id=>document.getElementById(id);
function money(v){return `${v.toLocaleString('ar-LY')} د.ل`}
function renderCategories(){ $('categoryTiles').innerHTML=categories.map(c=>`<button class="category" data-cat="${c[0]}"><div class="cat-icon">${c[1]}</div><b>${c[0]}</b><small>${c[2]}</small></button>`).join('');}
function filtered(){let list=products.filter(p=>(activeCategory==='الكل'||p.cat===activeCategory)&&(!searchTerm||(p.name+' '+p.cat+' '+p.brand).toLowerCase().includes(searchTerm.toLowerCase()))&&(!favoritesOnly||favorites.includes(p.id)));let sort=$('sortSelect').value;if(sort==='price-asc')list.sort((a,b)=>a.price-b.price);if(sort==='price-desc')list.sort((a,b)=>b.price-a.price);if(sort==='name')list.sort((a,b)=>a.name.localeCompare(b.name,'ar'));return list}
function renderProducts(){let list=filtered();$('productsHeading').textContent=favoritesOnly?'المنتجات المفضلة':activeCategory==='الكل'?(searchTerm?'نتائج البحث':'منتجاتنا'):activeCategory;$('productGrid').innerHTML=list.map(p=>`<article class="product"><div class="product-img"><span>${p.emoji}</span>${p.tag?`<span class="tag">${p.tag}</span>`:''}<button class="heart ${favorites.includes(p.id)?'on':''}" data-fav="${p.id}" aria-label="إضافة للمفضلة">${favorites.includes(p.id)?'♥':'♡'}</button></div><div class="product-info"><span class="product-cat">${p.cat}</span><h3>${p.name}</h3><div class="product-meta"><span>${p.brand}</span><span>${p.stock>0?'متوفر':'نفد المخزون'}</span></div><div class="price-row"><span class="price">${money(p.price)}</span><button class="add" data-add="${p.id}" ${p.stock<=0?'disabled':''}>＋</button></div></div></article>`).join('');$('emptyState').classList.toggle('hidden',list.length>0)}
function saveCart(){localStorage.setItem('mw_cart',JSON.stringify(cart));renderCartCount()}
function renderCartCount(){$('cartCount').textContent=cart.reduce((n,x)=>n+x.qty,0)}
function addCart(id){let p=products.find(x=>x.id===id);let item=cart.find(x=>x.id===id);if(item)item.qty++;else cart.push({id,qty:1});saveCart();renderCart();toast(`تمت إضافة «${p.name}» إلى السلة`)}
function renderCart(){let items=cart.map(x=>({...products.find(p=>p.id===x.id),qty:x.qty})).filter(Boolean);$('cartItems').innerHTML=items.length?items.map(p=>`<div class="cart-item"><span class="cart-emoji">${p.emoji}</span><div class="cart-item-info"><b>${p.name}</b><small>${money(p.price)} · ${money(p.price*p.qty)}</small><div class="qty"><button data-qty="-1" data-id="${p.id}">−</button><span>${p.qty}</span><button data-qty="1" data-id="${p.id}">＋</button></div></div></div>`).join(''):'<div class="empty">السلة فارغة حالياً 🛒</div>';$('cartTotal').textContent=money(items.reduce((s,p)=>s+p.price*p.qty,0))}
function openCart(){$('cartDrawer').classList.add('open');$('overlay').classList.add('show');$('cartDrawer').setAttribute('aria-hidden','false')}
function closeCart(){$('cartDrawer').classList.remove('open');$('overlay').classList.remove('show');$('cartDrawer').setAttribute('aria-hidden','true')}
function toast(msg){let el=$('toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2300)}
function whatsappCheckout(){if(!cart.length){toast('أضف منتجات إلى السلة أولاً');return}let items=cart.map(x=>{let p=products.find(y=>y.id===x.id);return `${p.name} × ${x.qty} = ${money(p.price*x.qty)}`}).join('\n');let total=cart.reduce((s,x)=>s+products.find(p=>p.id===x.id).price*x.qty,0);let message=`السلام عليكم، أريد طلب المنتجات التالية من خبر عاجل سبها:\n${items}\nالإجمالي: ${money(total)}\nالاسم: \nالعنوان: \n`;toast('يرجى إعداد رقم واتساب المتجر في app.js');let phone='';if(phone)window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,'_blank');else alert(message+'\n\nملاحظة للمطور: أضف رقم واتساب المتجر في المتغير phone داخل app.js.')}
$('navCategories').addEventListener('click',e=>{let a=e.target.closest('[data-cat]');if(!a)return;activeCategory=a.dataset.cat;favoritesOnly=false;document.querySelectorAll('#navCategories a').forEach(x=>x.classList.toggle('active',x===a));renderProducts();$('productsHeading').scrollIntoView({behavior:'smooth',block:'start'})});
$('categoryTiles').addEventListener('click',e=>{let a=e.target.closest('[data-cat]');if(a){activeCategory=a.dataset.cat;favoritesOnly=false;renderProducts();$('productsHeading').scrollIntoView({behavior:'smooth'})}});
$('productGrid').addEventListener('click',e=>{let add=e.target.closest('[data-add]');if(add)addCart(+add.dataset.add);let fav=e.target.closest('[data-fav]');if(fav){let id=+fav.dataset.fav;favorites=favorites.includes(id)?favorites.filter(x=>x!==id):[...favorites,id];localStorage.setItem('mw_favs',JSON.stringify(favorites));renderProducts()}});
$('searchBtn').onclick=()=>{searchTerm=$('searchInput').value.trim();activeCategory='الكل';favoritesOnly=false;renderProducts()};
$('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter') $('searchBtn').click()});
$('sortSelect').onchange=renderProducts;$('browseBtn').onclick=()=>$('categoryTiles').scrollIntoView({behavior:'smooth'});$('allCategories').onclick=()=>{activeCategory='الكل';favoritesOnly=false;renderProducts();$('productsHeading').scrollIntoView({behavior:'smooth'})};
$('cartBtn').onclick=openCart;$('closeCart').onclick=closeCart;$('overlay').onclick=closeCart;$('cartItems').addEventListener('click',e=>{let b=e.target.closest('[data-qty]');if(!b)return;let item=cart.find(x=>x.id===+b.dataset.id);item.qty+=+b.dataset.qty;if(item.qty<=0)cart=cart.filter(x=>x.id!==item.id);saveCart();renderCart()});
$('checkoutBtn').onclick=whatsappCheckout;$('wholesaleBtn').onclick=()=>toast('أضف رقم واتساب المتجر للتواصل بشأن أسعار الجملة');$('footerWhatsApp').onclick=e=>{e.preventDefault();toast('أضف رقم واتساب المتجر في إعدادات المشروع')};
$('favBtn').onclick=()=>{favoritesOnly=!favoritesOnly;activeCategory='الكل';renderProducts();$('productsHeading').scrollIntoView({behavior:'smooth'})};
renderCategories();renderProducts();renderCartCount();renderCart();
