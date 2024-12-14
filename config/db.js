const mysql = require('mysql2/promise'); // Sử dụng phiên bản promise

// Tạo connection pool với promise
const pool = mysql.createPool({
    host: "gamehay.id.vn", // Đảm bảo đúng host
    user: "ndbdxcjw_doanchuyennganh",
    password: "YcuDSH8P5nWaxGuzYebR", // Thay bằng biến môi trường
    database: "ndbdxcjw_doanchuyennganh",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

// Kiểm tra kết nối và thực hiện một truy vấn đơn giản
(async () => {
    try {
        // Sử dụng pool.query thay vì pool.getConnection
        const [rows, fields] = await pool.query('SELECT 1');
        console.log('Kết nối MySQL thành công!', rows);
    } catch (err) {
        console.error("Kết nối MySQL thất bại: ", err.message);
    }
})();

// Export pool để sử dụng
module.exports = pool;
