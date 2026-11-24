# openGauss 主备演示镜像：官方镜像 + openblas + 主备初始化脚本
ARG OPENGAUSS_IMAGE=opengauss/opengauss:7.0.0-RC3.B025-amd64-openEuler22.03
FROM ${OPENGAUSS_IMAGE}

USER root
# openGauss-lite 依赖 libopenblas.so.0，官方镜像未预装（D 的环境记录里也提到过）
RUN (dnf install -y openblas || dnf install -y openblas-threads || yum install -y openblas) \
    && ldconfig \
    && (ldd /usr/local/opengauss/bin/gaussdb 2>/dev/null | grep -i openblas || true)

COPY entrypoint-ha.sh /usr/local/bin/entrypoint-ha.sh
RUN chmod 755 /usr/local/bin/entrypoint-ha.sh \
    && mkdir -p /var/lib/opengauss/data \
    && chown -R omm /var/lib/opengauss

USER omm
ENTRYPOINT ["/usr/local/bin/entrypoint-ha.sh"]
