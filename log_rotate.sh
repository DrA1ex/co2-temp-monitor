BASEDIR="${BASEDIR=$(dirname "$0")}"
LINES=3000

LOG_DIR="${BASEDIR}/logs"

time=$(date '+%Y-%m-%dT%H-%M-%S')
name="${LOG_DIR}/temp_${time}.log"

mkdir -p "${LOG_DIR}"
cp "${BASEDIR}/temp.log" "${name}"
tail -n ${LINES} < "${name}" > "${BASEDIR}/temp.log"