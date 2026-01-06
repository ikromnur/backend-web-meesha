// Gunakan require agar tidak bergantung pada deklarasi tipe eksternal saat runtime
// dan menghindari TS2307 pada lingkungan ts-node/nodemon.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require("pdfkit");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require("sharp");

type OrderItemLike = {
  product?: { name?: string } | null;
  quantity: number;
  price: number;
  // optional image for richer invoice
  productImageUrl?: string | null;
};

type OrderLike = {
  id: string;
  status?: string;
  paymentMethod?: string | null;
  paymentMethodCode?: string | null;
  totalAmount?: number | null;
  createdAt?: Date | string | null;
  paidAt?: Date | string | null;
  orderItems?: OrderItemLike[];
  // richer metadata
  shippingAddress?: string | null;
  pickupAt?: Date | string | null;
  user?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
};

const currency = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(
    Number(n || 0)
  );

// Helper: normalisasi berbagai bentuk field imageUrl (string/obj/array)
const resolveImageUrlGeneric = (image: any): string | undefined => {
  if (!image) return undefined;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) {
    const first = image[0];
    if (!first) return undefined;
    if (typeof first === "string") return first;
    if (typeof first === "object" && first)
      return String(
        first.secure_url || first.url || first.src || first.path || ""
      );
  }
  if (typeof image === "object") {
    return String(
      image.secure_url || image.url || image.src || image.path || ""
    );
  }
  return undefined;
};

export const buildInvoiceHtml = (order: OrderLike) => {
  const items = (order.orderItems || []).map((oi: any) => ({
    name: oi.product?.name || "Produk",
    quantity: oi.quantity,
    price: oi.price,
    imageUrl:
      resolveImageUrlGeneric(oi.product?.imageUrl) ||
      oi.productImageUrl ||
      null,
  }));

  const rows = items
    .map(
      (it) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${
          it.name
        }</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${
          it.quantity
        }</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${currency(
          it.price
        )}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${currency(
          it.price * it.quantity
        )}</td></tr>`
    )
    .join("");

  const imageColumnHeader = `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;">Gambar</th>`;
  const table = rows
    ? `<table style="width:100%;border-collapse:collapse;margin-top:12px;">` +
      `<thead><tr>${imageColumnHeader}<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;">Produk</th><th style="text-align:center;padding:6px 8px;border-bottom:2px solid #ddd;">Qty</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #ddd;">Harga</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #ddd;">Subtotal</th></tr></thead>` +
      `<tbody>` +
      items
        .map(
          (it) =>
            `<tr>` +
            `<td style="padding:6px 8px;border-bottom:1px solid #eee;">${
              it.imageUrl
                ? `<img src="${it.imageUrl}" alt="${it.name}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;"/>`
                : ""
            }</td>` +
            `<td style="padding:6px 8px;border-bottom:1px solid #eee;">${it.name}</td>` +
            `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${it.quantity}</td>` +
            `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${currency(
              it.price
            )}</td>` +
            `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${currency(
              it.price * it.quantity
            )}</td>` +
            `</tr>`
        )
        .join("") +
      `</tbody>` +
      `</table>`
    : "";

  const paidAt = order.paidAt
    ? new Date(order.paidAt).toLocaleString("id-ID")
    : "-";
  const createdAt = order.createdAt
    ? new Date(order.createdAt).toLocaleString("id-ID")
    : "-";

  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Invoice - ${order.id}</title>
  </head>
  <body style="font-family:Arial,sans-serif;color:#333;max-width:800px;margin:24px auto;padding:16px;">
    <h2 style="margin:0 0 8px 0;">Invoice Pembayaran</h2>
    <p style="margin:4px 0;">Nomor Pesanan: <strong>${order.id}</strong></p>
    <p style="margin:4px 0;">Tanggal Pesanan: <strong>${createdAt}</strong></p>
    <p style="margin:4px 0;">Status: <strong>${order.status || "-"}</strong></p>
    <p style="margin:4px 0;">Metode Pembayaran: <strong>${
      order.paymentMethod || "-"
    }${order.paymentMethodCode ? ` (${order.paymentMethodCode})` : ""}</strong></p>
    <p style="margin:4px 0;">Dibayar Pada: <strong>${paidAt}</strong></p>
    <div style="display:flex;gap:24px;margin-top:10px;">
      <div style="flex:1;">
        <h4 style="margin:6px 0;">Pelanggan</h4>
        <p style="margin:2px 0;">Nama: <strong>${
          order.user?.name || "-"
        }</strong></p>
        <p style="margin:2px 0;">Email: <strong>${
          order.user?.email || "-"
        }</strong></p>
        <p style="margin:2px 0;">Telepon: <strong>${
          order.user?.phone || "-"
        }</strong></p>
      </div>
      <div style="flex:1;">
        <h4 style="margin:6px 0;">Alamat / Catatan</h4>
        <p style="margin:2px 0;">${order.shippingAddress || "-"}</p>
      </div>
    </div>
    ${table}
    <p style="margin-top:12px;">Total: <strong>${currency(
      Number(order.totalAmount || 0)
    )}</strong></p>
    <hr style="margin:16px 0;"/>
    <p>Terima kasih telah berbelanja di Meesha.co</p>
  </body>
  </html>`;

  return html;
};

export const generateInvoicePdf = async (order: OrderLike): Promise<Buffer> => {
  return await new Promise<Buffer>(async (resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    const write = (text: string, options?: { bold?: boolean }) => {
      if (options?.bold) doc.font("Helvetica-Bold");
      else doc.font("Helvetica");
      doc.text(text);
    };

    doc.on("data", (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    doc.on("error", (err: Error) => reject(err));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    // Helper: normalisasi URL gambar agar absolut
    const resolvePublicUrl = (url?: string | null) => {
      const u = (url || "").trim();
      if (!u) return undefined;
      // sudah absolut
      if (/^https?:\/\//i.test(u)) return u;
      // jika relatif, prefix dengan ASSET_BASE_URL atau APP_BASE_URL
      const base =
        (process.env.ASSET_BASE_URL || "").trim() ||
        (process.env.APP_BASE_URL || "").trim();
      if (!base) return undefined;
      return `${base.replace(/\/$/, "")}/${u.replace(/^\//, "")}`;
    };

    // Helper untuk ambil dan kompres gambar dari URL
    const fetchImageBuffer = async (url?: string | null) => {
      try {
        const normalized = resolveImageUrlGeneric(url);
        if (!normalized) return undefined;
        const resolved = resolvePublicUrl(normalized) || normalized;
        // Gunakan global fetch jika tersedia (Node 18+)
        // Jika tidak tersedia, abaikan gambar tanpa melempar error.
        if (typeof fetch !== "function") return undefined;
        const resp = await fetch(resolved);
        if (!resp.ok) return undefined;
        const ab = await resp.arrayBuffer();
        const buf = Buffer.from(ab);
        // Kompres dan resize kecil untuk invoice
        try {
          return await sharp(buf)
            .resize(60, 60, { fit: "cover" })
            .jpeg({ quality: 80 })
            .toBuffer();
        } catch (_) {
          return buf;
        }
      } catch (_) {
        return undefined;
      }
    };

    // Branding & aset
    const brandName = (process.env.INVOICE_BRAND_NAME || "Meesha.co").trim();
    const logoRel = (
      process.env.INVOICE_LOGO_PATH || "/images/logo.png"
    ).trim();
    const qrisRel = (
      process.env.INVOICE_QRIS_PATH || "/images/qris.png"
    ).trim();
    const footerNote = (
      process.env.INVOICE_FOOTER_NOTE ||
      "Terima kasih telah berbelanja di Meesha.co"
    ).trim();
    const logoBuf = await fetchImageBuffer(logoRel);

    // Header
    doc.fontSize(18);
    write("Invoice Pembayaran", { bold: true });
    doc.moveDown(0.5);
    doc.fontSize(12);
    if (logoBuf) {
      try {
        // Tempatkan logo di kanan atas
        doc.image(logoBuf, 450, 50, { width: 100 });
      } catch (_) {}
    }
    // Brand
    write(`Brand: ${brandName}`);
    write(`Nomor Pesanan: ${order.id}`);
    write(
      `Tanggal Pesanan: ${
        order.createdAt
          ? new Date(order.createdAt).toLocaleString("id-ID")
          : "-"
      }`
    );
    write(`Status: ${order.status || "-"}`);
    write(
      `Metode Pembayaran: ${order.paymentMethod || "-"}${
        order.paymentMethodCode ? ` (${order.paymentMethodCode})` : ""
      }`
    );
    write(
      `Dibayar Pada: ${
        order.paidAt ? new Date(order.paidAt).toLocaleString("id-ID") : "-"
      }`
    );
    write(
      `Pickup Dijadwalkan: ${
        order.pickupAt ? new Date(order.pickupAt).toLocaleString("id-ID") : "-"
      }`
    );

    // Detail pelanggan dan alamat
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").text("Pelanggan");
    doc.font("Helvetica");
    write(`Nama: ${order.user?.name || "-"}`);
    write(`Email: ${order.user?.email || "-"}`);
    write(`Telepon: ${order.user?.phone || "-"}`);

    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").text("Alamat / Catatan");
    doc.font("Helvetica");
    write(`${order.shippingAddress || "-"}`);

    doc.moveDown();
    // Table header (dengan kolom gambar)
    const colImageX = 50;
    const colNameX = 120;
    const colQtyX = 330;
    const colPriceX = 390;
    const colSubtotalX = 470;
    doc.font("Helvetica-Bold");
    doc.text("Gambar", colImageX, doc.y, { width: 60 });
    doc.text("Produk", colNameX, doc.y, { width: 200 });
    doc.text("Qty", colQtyX, doc.y, { width: 60, align: "center" });
    doc.text("Harga", colPriceX, doc.y, { width: 80, align: "right" });
    doc.text("Subtotal", colSubtotalX, doc.y, { width: 80, align: "right" });
    doc.font("Helvetica");
    doc
      .moveTo(50, doc.y + 16)
      .lineTo(545, doc.y + 16)
      .stroke();
    doc.moveDown(1);

    const items = (order.orderItems || []) as OrderItemLike[];
    for (const it of items) {
      const name = it.product?.name || "Produk";
      const y = doc.y + 4;
      let rowHeight = 24;
      // gambar produk jika ada
      try {
        const imgBuf = await fetchImageBuffer(
          resolveImageUrlGeneric((it as any).product?.imageUrl) ||
            it.productImageUrl ||
            null
        );
        if (imgBuf) {
          doc.image(imgBuf, colImageX, y, { width: 60, height: 60 });
          rowHeight = 68;
        }
      } catch (_) {}

      doc.text(name, colNameX, y, { width: 200 });
      doc.text(String(it.quantity), colQtyX, y, {
        width: 60,
        align: "center",
      });
      doc.text(currency(it.price), colPriceX, y, {
        width: 80,
        align: "right",
      });
      doc.text(currency(it.price * it.quantity), colSubtotalX, y, {
        width: 80,
        align: "right",
      });
      // garis pemisah
      const nextY = y + rowHeight;
      doc.moveTo(50, nextY).lineTo(545, nextY).stroke();
      doc.y = nextY + 2;
    }

    doc.moveDown();
    doc
      .font("Helvetica-Bold")
      .text(`Total: ${currency(Number(order.totalAmount || 0))}`);
    doc.font("Helvetica");
    doc.moveDown();
    doc.text(footerNote);

    // QRIS (tampilkan jika belum dibayar dan aset tersedia)
    if (!order.paidAt) {
      try {
        const qrisBuf = await fetchImageBuffer(qrisRel);
        if (qrisBuf) {
          doc.moveDown();
          doc.font("Helvetica-Bold").text("Bayar via QRIS");
          doc.font("Helvetica");
          const y = doc.y + 4;
          doc.image(qrisBuf, 50, y, { width: 180, height: 180 });
          doc.y = y + 190;
          doc.text("Scan kode QRIS untuk menyelesaikan pembayaran.");
        }
      } catch (_) {}
    }

    doc.end();
  });
};

export default {
  buildInvoiceHtml,
  generateInvoicePdf,
};
