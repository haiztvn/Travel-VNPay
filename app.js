const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const app = express();
const cors = require("cors"); // Import middleware CORS
const db = require('./config/db');
///
let $ = require('jquery');
const moment = require('moment');
const config = require('config');
///
app.use(cors());
const port = process.env.PORT || 5001;

// Thiết lập thông tin kết nối MoMo
const accessKey = "F8BBA842ECF85";
const secretKey = "K951B6PE1waDMi640xX08PD3vg6EkVlz";
const partnerCode = "MOMO";
// const redirectUrl = "https://auorient.com";
const redirectUrl = "https://auorient.com/profile/account-orders";
const ipnUrl = "https://travel-vnpay.onrender.com/callback"; // URL gọi lại sau khi thanh toán

app.use(express.json());
const generateOrderId = (donHangId) => {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    return `DH${donHangId}_${timestamp}_${randomString}`;
};

app.post("/payment", async (req, res) => {
    const DonHangID = req.body.DonHangID;
    const TenKH = req.body.TenKH;

    const [orderStatus] = await db.query('SELECT TrangThai FROM donhang WHERE DonHangID = ?', [DonHangID]);

    if (!orderStatus || orderStatus.length === 0) {
        return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    }
    else if (!DonHangID || !TenKH) {
        return res.status(400).json({ error: 'DonHangID và TenKH là bắt buộc' });
    }
    else if (orderStatus[0].TrangThai === 'paid' || orderStatus[0].TrangThai === 'completed') {
        return res.status(400).json({ error: 'Đơn hàng đã được thanh toán. Không thể tạo thanh toán mới.' });
    }
    else {
        try {
            // Truy vấn tổng giá trị đơn hàng
            const [orderDetails] = await db.query(`
            SELECT SUM(ctdh.GiaVe) AS totalAmount
            FROM donhang dh
            JOIN chitietdonhang ctdh ON dh.DonHangID = ctdh.DonHangID
            WHERE dh.DonHangID = ?`, [DonHangID]);

            if (!orderDetails || orderDetails.length === 0) {
                return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
            }
            else {
                const totalAmount = Math.floor(orderDetails[0].totalAmount);

                // Tạo OrderId duy nhất
                const orderId = generateOrderId(DonHangID);
                await db.query('UPDATE donhang SET OrderId = ? WHERE DonHangID = ?', [orderId, DonHangID]);

                const requestId = partnerCode + new Date().getTime();
                const orderInfo = "Thanh toán qua MoMo";
                const requestType = "captureWallet";
                const extraData = "";

                const rawSignature =
                    `accessKey=${accessKey}&amount=${totalAmount}&extraData=${extraData}&ipnUrl=${ipnUrl}` +
                    `&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${partnerCode}` +
                    `&redirectUrl=${redirectUrl}&requestId=${requestId}&requestType=${requestType}`;

                const signature = crypto.createHmac('sha256', secretKey).update(rawSignature).digest('hex');

                const requestBody = {
                    partnerCode,
                    accessKey,
                    requestId,
                    amount: totalAmount.toString(),
                    orderId,
                    orderInfo,
                    redirectUrl,
                    ipnUrl,
                    extraData,
                    requestType,
                    signature,
                    lang: 'vi',
                };

                // Gửi yêu cầu thanh toán đến MoMo
                const response = await axios.post('https://test-payment.momo.vn/v2/gateway/api/create', requestBody, {
                    headers: { 'Content-Type': 'application/json' },
                });

                if (response.data && response.data.payUrl) {
                    return res.json({ payUrl: response.data.payUrl });
                } else {
                    return res.status(400).json({ error: 'Lỗi từ MoMo: Không có payUrl' });
                }
            }
        } catch (error) {
            console.error('Lỗi:', error.message);
            return res.status(500).json({ error: 'Lỗi hệ thống' });
        }
    }

});
// Xử lý callback từ MoMo sau khi thanh toán
app.post('/callback', async (req, res) => {
    console.log('Nhận callback từ MoMo:', req.body);

    const { orderId, resultCode, transId, amount, message } = req.body;

    if (resultCode === 0) {
        try {
            // Kiểm tra OrderId
            const [orderResult] = await db.query('SELECT * FROM donhang WHERE OrderId = ?', [orderId]);
            const order = orderResult[0]; // Lấy kết quả đầu tiên nếu tìm thấy
            if (!order) {
                return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
            }

            else if (order.TrangThai === 'paid') {
                return res.status(400).json({ error: 'Đơn hàng đã được thanh toán' });
            }
            else if (!order.DonHangID) {
                console.log('Đơn hàng chưa có  order.DonHangID');
            }
            else {
                // Cập nhật trạng thái đơn hàng
                await db.query('UPDATE donhang SET TrangThai = ?  WHERE OrderId = ?', ['paid', orderId]);

                // Lưu thông tin thanh toán
                const paymentInfo = {
                    TenTT: 'MoMo Payment',
                    NoiDungTT: message || 'Thanh toán qua MoMo',
                    NgayTT: new Date(),
                    DonHangID: order.DonHangID,
                    Status: 'Success',
                    TransId: transId,
                    Amount: amount,
                };

                await db.query('INSERT INTO thanhtoan SET ?', paymentInfo);
                return res.status(200).json({ message: 'Thanh toán thành công' });
            }

        } catch (error) {
            console.error('Lỗi xử lý callback:', error.message);
            return res.status(500).json({ error: 'Lỗi hệ thống' });
        }
    } else {
        console.log(`Giao dịch thất bại: ${message}`);
        return res.status(200).json({ message: 'Giao dịch thất bại' });
    }
});

app.post('/create_payment_url', async (req, res, next) => {
    const DonHangID = req.body.DonHangID;  // Assuming DonHangID comes from the client request
    const TenKH = req.body.TenKH;  // Assuming TenKH comes from the client request
    if (!DonHangID || !TenKH) {
        return res.status(400).json({ error: 'DonHangID is required' });
    }
    const tenKhNoDau = TenKH.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    try {
        const [orderDetails] = await db.query(`
            SELECT SUM(ctdh.GiaVe) AS totalAmount
            FROM donhang dh
            JOIN chitietdonhang ctdh ON dh.DonHangID = ctdh.DonHangID
            WHERE dh.DonHangID = ?`, [DonHangID]);

        if (!orderDetails.length) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const totalAmount = orderDetails[0].totalAmount * 100;  // VNPAY expects the amount in VND (multiplied by 100)

        process.env.TZ = 'Asia/Ho_Chi_Minh';

        let date = new Date();
        let createDate = moment(date).format('YYYYMMDDHHmmss');

        let ipAddr = req.headers['x-forwarded-for'] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            req.connection.socket.remoteAddress;

        let config = require('config');

        let tmnCode = config.get('vnp_TmnCode');
        let secretKey = config.get('vnp_HashSecret');
        let vnpUrl = config.get('vnp_Url');
        let returnUrl = config.get('vnp_ReturnUrl');
        let orderId = DonHangID;
        let bankCode = req.body.bankCode;
        let locale = req.body.language || 'vn';
        let currCode = 'VND';

        let vnp_Params = {};
        vnp_Params['vnp_Version'] = '2.1.0';
        vnp_Params['vnp_Command'] = 'pay';
        vnp_Params['vnp_TmnCode'] = tmnCode;
        vnp_Params['vnp_Locale'] = locale;
        vnp_Params['vnp_CurrCode'] = currCode;
        vnp_Params['vnp_TxnRef'] = orderId;
        vnp_Params['vnp_OrderInfo'] = `Khach hang ${tenKhNoDau}. Thanh toan don hang ${DonHangID}`;
        vnp_Params['vnp_OrderType'] = 'other';
        vnp_Params['vnp_Amount'] = totalAmount;
        vnp_Params['vnp_ReturnUrl'] = returnUrl;
        vnp_Params['vnp_IpAddr'] = ipAddr;
        vnp_Params['vnp_CreateDate'] = createDate;

        if (bankCode) {
            vnp_Params['vnp_BankCode'] = bankCode;
        }

        vnp_Params = sortObject(vnp_Params);  // Sort the object

        let querystring = require('qs');
        let signData = querystring.stringify(vnp_Params, { encode: false });

        let crypto = require("crypto");
        let hmac = crypto.createHmac("sha512", secretKey);
        let signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");

        vnp_Params['vnp_SecureHash'] = signed;
        // vnpUrl += '?' + querystring.stringify(vnp_Params, { encode: false });

        const paymentUrl = `${vnpUrl}?${querystring.stringify(vnp_Params, { encode: false })}`;
        res.status(200).json({ paymentUrl });

    } catch (err) {
        console.error('Error creating payment URL:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/vnpay_return', async function (req, res, next) {
    let vnp_Params = req.query;

    let secureHash = vnp_Params['vnp_SecureHash'];

    delete vnp_Params['vnp_SecureHash'];
    delete vnp_Params['vnp_SecureHashType'];

    vnp_Params = sortObject(vnp_Params);

    let config = require('config');
    let tmnCode = config.get('vnp_TmnCode');
    let secretKey = config.get('vnp_HashSecret');

    let querystring = require('qs');
    let signData = querystring.stringify(vnp_Params, { encode: false });
    let crypto = require("crypto");
    let hmac = crypto.createHmac("sha512", secretKey);
    let signed = hmac.update(new Buffer.from(signData, 'utf-8')).digest("hex");


    if (secureHash === signed) {
        // Kết nối database
        const db = require('./config/db');
        const orderId = vnp_Params['vnp_TxnRef'];
        const amount = parseFloat(vnp_Params['vnp_Amount']) / 100; // VNPay trả về số tiền nhân 100
        const rspCode = vnp_Params['vnp_ResponseCode'];
        const transactionDate = vnp_Params['vnp_PayDate'];
        console.log('Amount from VNPay:', amount);
        console.log('Amount from VNPay:', orderId);
        console.log('Response Code:', vnp_Params['vnp_ResponseCode']);

        try {
            // Kiểm tra mã đơn hàng trong CSDL
            const [order] = await db.query('SELECT * FROM donhang WHERE DonHangID = ?', [orderId]);
            if (!order) {
                console.log('aa');
                return res.status(404).json({ code: '01', message: 'Order not found' });
            }

            // Kiểm tra trạng thái giao dịch trước khi cập nhật
            if (order.TrangThai === 'paid') {
                console.log('bb');
                return res.status(404).json({ code: '02', message: 'Order already paid' });
            }

            // Xử lý giao dịch
            if (rspCode === '00') {
                // Giao dịch thành công
                await db.query('UPDATE donhang SET TrangThai = ? WHERE DonHangID = ?', ['paid', orderId]);
                await db.query(`INSERT INTO thanhtoan (TenTT, NoiDungTT, NgayTT, DonHangID, Status, TransId, Amount)
                    VALUES (?, ?, ?, ?, ?,?,?)`, [
                    'VNPay Payment',
                    vnp_Params['vnp_OrderInfo'],
                    transactionDate,
                    orderId,
                    'Success',
                    orderId,
                    amount,
                ]);
                return res.redirect('https://auorient.com/profile/account-orders');
            } else {
                // Giao dịch thất bại
                await db.query(`INSERT INTO thanhtoan (TenTT, NoiDungTT, NgayTT, DonHangID, Status, TransId, Amount)
                    VALUES (?, ?, ?, ?, ?,?,?)`, [
                    'VNPay Payment',
                    vnp_Params['vnp_OrderInfo'],
                    transactionDate,
                    orderId,
                    'Failed',
                    orderId,
                    amount,
                ]);
                return res.redirect('http://localhost:3000/profile/account-orders');
            }

        } catch (error) {
            console.error('Error processing payment:', error);
        }

    } else {
        return res.status(404).json({ code: '97', message: 'Invalid signature' });
    }
});

function sortObject(obj) {
    let sorted = {};
    let str = [];
    let key;

    // Push the original keys (not encoded) into the array
    for (key in obj) {
        if (obj.hasOwnProperty(key)) {
            str.push(key);  // Keep the original key
        }
    }

    // Sort the keys alphabetically
    str.sort();

    // Use the sorted keys to populate the `sorted` object, and encode both keys and values
    for (key of str) {
        sorted[encodeURIComponent(key)] = encodeURIComponent(obj[key]).replace(/%20/g, "+");
    }

    return sorted;
}
// Khởi động server
app.listen(port, () => {
    console.log('Chạy server tại cổng 5001');
});
